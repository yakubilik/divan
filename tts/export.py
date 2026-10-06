"""Export EMA Lightning to three ONNX files for the phone, and write vectors.json and the reference audio.

    .venv/bin/python export.py

models/text.onnx     ids [1, L] int64                      -> h [1, L, 224], dur [1, L] (frames per letter)
models/sound.onnx    h, dur, cw, wstart [1, L]; fw, fp [1, T]; noise [1, 4, T, 64]
                                                           -> latents [1, T, 64]  (the four steps unrolled)
models/decoder.onnx  z [1, n, 64]                          -> audio [1, n * 1920]  (48 kHz)

Between text and sound the host plans the frame timeline (common.plan); after sound it decodes window by
window (common.decode). Batch is 1: the phone speaks one piece at a time, so there is no padding and no
mask anywhere. Every graph is opset 15 and uses only operators of onnxruntime's mobile package (check.py
holds the list and enforces it).

The reference is EMA's own engine (plan, think, decode windows) on the same text, with its noise replaced by
common.noise, single-threaded so it is bit-for-bit repeatable.
"""
import json
import math
import sys
import warnings

import numpy as np
import onnx
import torch
import torch.nn.functional as F
from huggingface_hub import hf_hub_download

from ema_lightning import model as acoustic_module
from ema_lightning.chunker import chunk
from ema_lightning.decoder import load_decoder
from ema_lightning.engine import Engine, windows
from ema_lightning.frontend import Frontend
from ema_lightning.model import load_acoustic, rope

import common

REPO = "canberkkkkkk/ema-lightning"
REVISION = "7a6ba1ad216bb2f1da9863f80ac8770a6a807632"  # the published weights these vectors were made from
OPSET = 15

SENTENCES = [
    "Tamam, anladım.",
    "Evet, hemen bakıyorum.",
    "Merhaba, nasılsın?",
    "Bunu yarın konuşalım mı?",
    "Bugün hava çok güzel, yarın da yağmur yağacakmış; toplantı öğleden sonra başlayacak.",
    "Kodu inceledim, testlerin hepsi geçiyor ama giriş ekranında küçük bir hizalama sorunu var.",
    "Uygulamayı telefonuna kurdum, bildirimler geliyor ve sesli mesajlar artık düzgün çalıyor.",
    "Toplantı 14 Mart 2026 Cuma günü saat 15:30'da başlayacak.",
    "Fatura tutarı 1.250,75 TL, son ödeme tarihi 3 Ekim.",
    "Sunucu son 5 dakikada %85 yükte çalıştı ve 2,5 GB bellek kullandı.",
    "Dr. Ayşe Hanım ikinci kattaki 205 numaralı odada sizi bekliyor.",
    "1999 yılının 17 Ağustos gecesi saat 03:02'de büyük bir deprem oldu.",
]
SEED = 1000  # sentence i uses seed SEED + i


def scaled(x, norm):
    """LayerNorm written out, so opset 15 graphs carry plain reductions instead of LayerNormalization."""
    mean = x.mean(-1, keepdim=True)
    var = ((x - mean) ** 2).mean(-1, keepdim=True)
    y = (x - mean) / torch.sqrt(var + norm.eps)
    return y * norm.weight + norm.bias if norm.weight is not None else y


def group_norm(x, norm):
    """GroupNorm(1, C) over [1, C, L] with no padding: statistics over everything."""
    mean = x.mean((1, 2), keepdim=True)
    var = ((x - mean) ** 2).mean((1, 2), keepdim=True)
    return (x - mean) / torch.sqrt(var + norm.eps) * norm.weight[None, :, None] + norm.bias[None, :, None]


def attention(q, k, v):
    return torch.softmax((q @ k.transpose(-2, -1)) / math.sqrt(q.shape[-1]), -1) @ v


class TextStage(torch.nn.Module):
    """model.text_stage for one unpadded piece."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, ids):
        text, dur = self.m.text, self.m.chardur
        x = text.emb(ids)
        for b in text.conv:
            y = scaled(b.dw(x.transpose(1, 2)).transpose(1, 2), b.norm)
            x = x + b.gamma * b.pw2(F.gelu(b.pw1(y)))
        assert len(text.attn) == 0, "this export covers text_attn = 0 (the published weights)"
        h = scaled(x, text.norm)
        y = group_norm(F.silu(dur.net[0](h.transpose(1, 2))), dur.net[2])
        y = group_norm(F.silu(dur.net[4](y)), dur.net[6])
        log_d = dur.out(y.transpose(1, 2)).squeeze(-1)
        return h, (torch.exp(torch.clamp(log_d, max=6.0)) - 1.0).clamp(min=1e-3)


class SoundStage(torch.nn.Module):
    """model.sound_stage for one unpadded piece, the four steps unrolled.

    scatter_add and gather along a dim (ScatterElements/GatherElements, not in the mobile build) become a
    one-hot letter-to-word matrix and plain Gather on 1-D tensors.
    """

    def __init__(self, model):
        super().__init__()
        self.m = model
        a = model.aligner
        assert a.letter_pos and model.shared, "this export covers letter_pos and shared_ada (the published weights)"

    def forward(self, h, dur, cw, wstart, fw, fp, noise):
        m, a = self.m, self.m.aligner
        L, T = h.shape[1], fw.shape[1]
        cwf, fwf = cw.float(), fw.float()
        onehot = (cwf[0][:, None] == torch.arange(L, dtype=torch.float32)[None]).float()  # [L, words <= L]
        c = dur.clamp(min=1e-4)
        done = torch.cumsum(c, -1)
        before = done - c
        total = (c @ onehot) @ onehot.t()
        cp = ((done - before[0][wstart[0]][None] - 0.5 * c) / total.clamp(min=1e-8)).clamp(0.0, 1.0)

        # aligner, letter_pos: global positions in letters
        wlen = (torch.ones_like(c) @ onehot).clamp(min=1.0)
        woff = torch.cumsum(wlen, -1) - wlen
        cg = woff @ onehot.t() + cp * (wlen @ onehot.t())
        fg = woff[0][fw[0]][None] + fp * wlen[0][fw[0]][None]
        D, H, dh = h.shape[2], a.h, a.dh
        q = a.q(a.frame_q).view(1, 1, H, dh).transpose(1, 2).expand(1, H, T, dh)
        k = a.k(h).view(1, L, H, dh).transpose(1, 2)
        v = a.v(h).view(1, L, H, dh).transpose(1, 2)
        q = acoustic_module.apply_rope(q, *(t[:, None] for t in rope(fg * a.pos_scale, dh)))
        k = acoustic_module.apply_rope(k, *(t[:, None] for t in rope(cg * a.pos_scale, dh)))
        logits = (q @ k.transpose(-2, -1)) / math.sqrt(dh) * a.log_temp.exp()
        sig2 = (a.log_sigma.exp() ** 2).view(1, H, 1, 1)
        dist2 = ((fg[:, :, None] - cg[:, None, :]) ** 2)[:, None]
        logits = logits - a.bias_w.view(1, H, 1, 1) * dist2 / (2 * sig2)
        rel = cwf[:, None, :] - fwf[:, :, None]
        allow = ((rel >= -a.lookback) & (rel <= a.lookahead))[:, None]
        attn = torch.where(allow, logits, torch.full_like(logits, -1e4)).softmax(-1) * allow.float()
        cond = a.o((attn @ v).transpose(1, 2).reshape(1, T, D))

        cos, sin = rope(torch.arange(T, dtype=torch.float32), m.dh)
        x = noise[:, 0]
        for i, t in enumerate(m.times):
            x1 = x + (1 - t) * self.backbone(x, cond, t, cos, sin)
            if i + 1 < len(m.times):
                x = (1 - m.times[i + 1]) * noise[:, i + 1] + m.times[i + 1] * x1
        return x1

    def backbone(self, x, cond, t, cos, sin):
        m = self.m
        with torch.no_grad():  # the step's time is fixed: its embeddings are constants
            c = m.t_embed(torch.tensor([t]))
            bc = m.ada_shared(c).view(-1, 6, m.d)
            s_out, g_out = m.ada_out(c).chunk(2, -1)
        x = m.in_proj(x) + cond
        for b in m.blocks:
            sa, ga, aa, sf, gf, af = (p.unsqueeze(1) for p in (bc + b.ada_offset[None]).unbind(1))
            x = x + aa * self.attn(b.attn, scaled(x, b.n1) * (1 + ga) + sa, cos, sin)
            x = x + af * b.ff(scaled(x, b.n2) * (1 + gf) + sf)
        return m.out_proj(scaled(x, m.norm_out) * (1 + g_out.unsqueeze(1)) + s_out.unsqueeze(1))

    @staticmethod
    def attn(block, x, cos, sin):
        _, T, D = x.shape
        q, k, v = (t.view(1, T, block.h, block.dh).transpose(1, 2) for t in block.qkv(x).chunk(3, -1))
        q, k = acoustic_module.apply_rope(q, cos, sin), acoustic_module.apply_rope(k, cos, sin)
        return block.proj(attention(q, k, v).transpose(1, 2).reshape(1, T, D))


class DecoderStage(torch.nn.Module):
    """The decoder on one unpadded window, latents channel-last as sound.onnx gives them."""

    def __init__(self, decoder):
        super().__init__()
        self.d = decoder

    def forward(self, z):
        return self.d(z.transpose(1, 2), None)


def export(module, args, path, inputs, outputs, axes):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        torch.onnx.export(module, args, str(path), opset_version=OPSET, input_names=inputs, output_names=outputs,
                          dynamic_axes=axes, do_constant_folding=True, dynamo=False)
    lift_constants(path)
    print(f"wrote {path.relative_to(common.HERE)} ({path.stat().st_size / 1e6:.1f} MB)")


def lift_constants(path):
    """Constant nodes become initializers, so the graph needs no kernel outside the mobile operator set."""
    model = onnx.load(str(path))
    graph, kept = model.graph, []
    for node in graph.node:
        if node.op_type == "Constant" and len(node.attribute) == 1 and node.attribute[0].name == "value":
            tensor = onnx.TensorProto()
            tensor.CopyFrom(node.attribute[0].t)
            tensor.name = node.output[0]
            graph.initializer.append(tensor)
        else:
            kept.append(node)
    del graph.node[:]
    graph.node.extend(kept)
    onnx.checker.check_model(model)
    onnx.save(model, str(path))


def main():
    torch.set_num_threads(1)  # repeatable reference audio
    common.MODELS.mkdir(exist_ok=True)
    common.REFERENCE.mkdir(exist_ok=True)
    model = load_acoustic(hf_hub_download(REPO, "ema.pt", revision=REVISION), "cpu")
    decoder = load_decoder(hf_hub_download(REPO, "decoder.pt", revision=REVISION), "cpu")
    assert decoder.hop == common.HOP and model.latent_dim == common.LATENT and len(model.times) == common.STEPS
    frontend = Frontend(model.vocab)
    engine = Engine(model, decoder, "cpu")

    # export, traced on a real sentence so every shape in the graph comes from real data
    text = chunk(frontend(SENTENCES[4]), 1.0)[0][0]
    ids = torch.tensor([[model.stoi.get(ch, 1) for ch in text]])
    cw, wstart = (torch.from_numpy(a)[None] for a in common.words(text))
    with torch.no_grad():
        h, dur = TextStage(model)(ids)
        _, fw, fp = (torch.from_numpy(a)[None] for a in common.plan(dur[0].numpy(), cw[0].numpy()))
        noise = torch.from_numpy(common.noise(0, fw.shape[1]))[None]
        latents = SoundStage(model)(h, dur, cw, wstart, fw, fp, noise)
        export(TextStage(model), (ids,), common.MODELS / "text.onnx", ["ids"], ["h", "dur"],
               {"ids": {1: "L"}, "h": {1: "L"}, "dur": {1: "L"}})
        export(SoundStage(model), (h, dur, cw, wstart, fw, fp, noise), common.MODELS / "sound.onnx",
               ["h", "dur", "cw", "wstart", "fw", "fp", "noise"], ["latents"],
               {"h": {1: "L"}, "dur": {1: "L"}, "cw": {1: "L"}, "wstart": {1: "L"}, "fw": {1: "T"},
                "fp": {1: "T"}, "noise": {2: "T"}, "latents": {1: "T"}})
        export(DecoderStage(decoder), (latents[:, :40],), common.MODELS / "decoder.onnx", ["z"], ["audio"],
               {"z": {1: "n"}, "audio": {1: "samples"}})

    # reference audio from EMA's own engine, with the portable noise
    vectors = {
        "about": "EMA Lightning test vectors: regenerate with tts/export.py. Audio is 48 kHz mono float32; "
                 "sha256 is over its little-endian float32 bytes. Noise is common.noise(seed, frames).",
        "weights": {"repo": REPO, "revision": REVISION},
        "rate": common.RATE, "hop": common.HOP, "window": common.WINDOW, "context": common.CONTEXT,
        "vocab": model.vocab,
        "sentences": [],
    }
    for i, sentence in enumerate(SENTENCES):
        pieces = chunk(frontend(sentence), 1.0)
        assert len(pieces) == 1, f"sentence {i} is more than one piece: {pieces}"
        spoken, seed = pieces[0][0], SEED + i
        piece = engine.piece(spoken, 0.0, seed)
        engine.noise = lambda p: torch.from_numpy(common.noise(p.seed, p.frames))
        engine.plan([piece], 1.0)
        engine.think([piece])
        audio = torch.cat(engine.decode([(piece, span) for span in windows(piece.frames)])).numpy()
        np.save(common.REFERENCE / f"{i:02d}.npy", audio)
        counts = np.bincount(piece.fw.numpy(), minlength=int(piece.cw[-1]) + 1)
        noise = common.noise(seed, piece.frames)
        vectors["sentences"].append({
            "text": sentence,
            "spoken": spoken,
            "ids": piece.ids.tolist(),
            "cw": piece.cw.tolist(),
            "wstart": piece.wstart.tolist(),
            "dur": [round(float(d), 4) for d in piece.dur],
            "word_frames": counts.tolist(),
            "frames": piece.frames,
            "seed": seed,
            "noise_shape": list(noise.shape),
            "noise_sha256": common.sha256(noise),
            "noise_head": [round(float(v), 6) for v in noise.reshape(-1)[:4]],
            "samples": int(audio.size),
            "seconds": round(audio.size / common.RATE, 4),
            "audio_sha256": common.sha256(audio),
            "rms": [round(float(v), 5) for v in common.rms(audio)],
        })
        print(f"{i:2d}  {audio.size / common.RATE:5.2f} s  {piece.frames:4d} frames  {spoken}")
    common.VECTORS.write_text(json.dumps(vectors, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote vectors.json ({len(SENTENCES)} sentences)")


if __name__ == "__main__":
    sys.exit(main())
