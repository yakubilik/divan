# Gece nöbeti

`nightly-ticket-review` skill'inin hafızası. Her gece `YYYY-MM-DD.md` altında o günün
notu; bu dosya açık bulguları, Yakup'un kararlarını ve "bir daha söyleme" dediklerini
taşır. Yeni bir gece eski bir bulguyu yeniden keşfetmez — burada varsa "şu tarihten
beri açık" diye bir kez anılır.

## Nöbet tutarken

- **Merge kuyruğun son adımı, işin son adımı değil.** Bir kriter ancak merge'den sonra
  kanıtlanabiliyorsa (CI koşusu, deploy, canlı uç) merge'den sonra dönüp bak: 30 Eyl
  akşamı #77 "deploy otomatik olsun" diye geçti, merge commit'inin CI koşusu kırmızıydı
  ve deploy hiç koşmadı.

- **Olay kaydı bulguyu verir, repo log'u onu doğrular.** Kuyruğun event'leri olanı
  anlatır, kodun o anki hâlini anlatmaz. Bir bulguyu yazmadan önce ilgili repo'da
  (`~/projects/ustabasi` başta olmak üzere) event penceresinden sonra atılmış commit
  var mı diye bak. 30 Eyl 2026'da sekiz bulgunun beşi bu yüzden yanlış yazıldı:
  olaylar 29 Eylül akşamındandı, fix'ler 29 Eyl 23:47 – 30 Eyl 11:27 arasındaydı.
- **"Neden böyle" sorusunu config'e de sor.** Bulgu sandığın şey bilinçli bir ayar
  olabilir; `ustabasi/config.py` yorumlarıyla birlikte okunur.

## Açık bulgular

| # | Bulgu | İlk görüldü | Durum |
|---|---|---|---|
| A1 | Merge'den sonra worktree silinmiyor; `clean` yalnızca CLI'da, supervisor çağırmıyor. 30 Eyl 15:16–15:20'de elle süpürüldü (9.8 GB → 964 MB) ama kod aynı: #77/#78 merge'inden sonra beş saatte yine 964 MB | 2026-09-30 | cevapsız, açık |
| A2 | Kapasite: yakup 2 Ekim 10:02'ye kadar kapalı, kuyruk tek hesapta yedeksiz (30 Eyl akşam yükü hafifti, ~$30) | 2026-09-30 | cevapsız, açık |
| A3 | #30 stale kill (20 dk çıktısız, 29 Eyl 16:12) — tek vaka, desen değil | 2026-09-30 | kapandı: 30 Eyl akşam penceresinde hiç stale/crash/ceiling yok |
| A4 | babysee/backend main'de CI kırmızı (`pnpm lint` OOM, exit 134); #77'nin kurduğu `deploy-beta` hiç koşmadı, beta hâlâ elle deploy | 2026-09-30 akşam | Yakup'a soruldu |
| A5 | Verifier kartın kriterlerini kapsamadan `pass` veriyor: #71'de 5 kriterden 1'i, `summary` = "Placeholder", main'e merge (c21a34d). 10 verifier koşusunun hepsi 6–12 sn / 1–3 tool | 2026-09-30 akşam | Yakup'a soruldu |
| A6 | "merge skipped: repo has uncommitted changes" geçici bir durum ama otomatik merge turu açmıyor, doğrudan kırmızıya düşüyor (#73, 2 commit silindi) | 2026-09-30 akşam | Yakup'a soruldu |

## Kararlar

- **2026-09-30** — Push kuyruğun işi değil: `default_allowed` bilerek `["merge"]`.
  Merge otomatik, push Yakup'ta. "N commit push bekliyor" bir bulgu değil.

## Kapanmış bulgular

30 Eyl 2026 sabahı, hepsi `~/projects/ustabasi`'de. Bir daha açılmaz:

| Bulgu | Commit |
|---|---|
| Park dönüşündeki ilk resume raporsuz 0 ile ölüyor (#42'de 5 kez) | `0637890` 29 Eyl 23:59 |
| Limit bildirimi yanlış pause ETA'sı gönderiyor | `6d5bf5d` 30 Eyl 00:31 |
| Sahipsiz dal hiçbir yerde görünmüyor | `2ee0ebd` 30 Eyl 00:38 |
| Verifier kartın istemediği test için ticket'ı geri gönderiyor (#57) | `76aed53` 30 Eyl 09:29 |
| Maestro PATH'te yok, Babysee e2e koşmuyor | `9fdcc68` 30 Eyl 11:11 |
| Bir round'a sığmayan kart / kırmızı sessizliği / flaky check / kriter kanıtı | `ac92a4c`, `1c2b2ae`, `9940082`, `762d817` |
| Mac restart'ında ölen run crash sayılıyor | `418fc59` 30 Eyl 11:27 |

## Bir daha sorulmayacaklar

_(Yakup "boş ver" / "bunu bir daha söyleme" dedikçe buraya.)_
