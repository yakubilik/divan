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
| A2 | Kapasite: kuyruk tek hesapta yedeksiz. 1 Eki'de bedriyan haftalık limite değdi, kuyruk 12:49–15:02 durdu; yakup 2 Ekim 10:02'de açılıyor | 2026-09-30 | cevapsız, açık |
| A4 | babysee backend main'de CI kırmızı (`pnpm lint` OOM); monorepo'da `Backend` workflow'unun son koşusu hâlâ failure (1 Eki 00:18), `deploy-beta` koşmuyor | 2026-09-30 akşam | soruldu, cevapsız |
| A5 | Verifier kriter kapısı kodda yok (#71 "Placeholder"). 1 Eki'de tekrarlamadı: 19/19 verdict her kriteri kapsıyor. Not: verifier'a diff prompt'ta gömülü gidiyor, az tool çağrısı "okumadı" demek değil | 2026-09-30 akşam | soruldu, cevapsız |
| A6 | "merge skipped: repo has uncommitted changes" otomatik yeniden denenmiyor, doğrudan kırmızı. 30 Eyl #73; 1 Eki #81, #98, #104. Kaynaklar: `isghocam-seo`'da 21:17 nightly'si `ranks.csv` + `gunluk/` dosyasını commit etmiyor; Divan'da yarım kalmış sohbet işi; kontrol komutunun kendisi (`uv run` bayat `uv.lock`'u yeniden yazıyordu, `75e18e7` ile kapandı). 1 Eki gecesi #98 ve #104 elle merge edildi; kod tarafı (yeniden deneme, nightly'nin commit'i) duruyor | 2026-09-30 akşam | 2 Eki: #105 Divan'da canlı sohbetin ana klonda commit'leri yüzünden 18 dk kırmızı. 5 Eki: isghocam-seo dört gündür kirli (2–5 Eki günlükleri), (a) yapılmadı; kod fix'i cevapsız |
| A7 | Ağ kesintisi crash sayılıyor: 1 Eki 05:09–~09:25, #88/#90/#91 üçer crash ile FAILED; 12 bildirimin hiçbiri gitmedi ve ağ dönünce yeniden gönderilmedi | 2026-10-01 | soruldu |
| A8 | `_merge` main'i dala aldıktan sonra `verify_cmd`'yi yeniden koşmuyor: #83 main'i kırdı (`dd3e9a6`, Lint + Deploy kırmızı) ve ✅ aldı. Aynı repoda paralel lane'lerin sonucu | 2026-10-01 | soruldu |
| A9 | Disk %97, 7,3 GB boş; 1 Eki 01:04'te #80 `ENOSPC` yedi. Kuyruk worker başlatmadan boş yere bakmıyor (`min_free_gb` yok) | 2026-10-01 | soruldu |
| A10 | Kart kalıbı: "merge + push + CI + canlı kontrol" `done_criteria`'da; 17 ticket'ın 12'si bu yüzden geri döndü ve merge'den sonra kimse bakmıyor (#83 CI, #79 `/yazar` canlıda 200). Öneri: `after_merge` alanı + merge sonrası CI kontrolü (30 Eyl akşam notundaki 1b ile aynı) | 2026-10-01 | 2 Eki: #99–#103 yine döndü ama kartları bulgudan önce yazılmıştı; bugün yazılan #106 dönmedi. Kod tarafı cevapsız |
| A11 | ustabasi reposunun remote'u yok; #94'te push "origin does not appear to be a git repository" ile döndü | 2026-10-01 | soruldu |
| A12 | Hesap girişi düşünce (OAuth expired) kuyruk bunu ticket crash'i sayıyor, yedek hesaba geçmiyor: 4 Eki #107/#108/#109 90 sn'de FAILED, bedriyan açıktı. 3 ve 4 Eki gece nöbetleri de aynı hatayla öldü (Divan nöbet hesabı sabit). Giriş 5 Eki 21:30'da geri geldi. A7 ile aynı kök | 2026-10-05 | soruldu; #108/#109 yeniden kuyruğa alınsın mı cevap bekliyor |

## Kararlar

- **2026-10-01** — Divan reposu public ve CI'da "nothing not-English" taraması var; bu klasör o taramayı kırmızı tutuyor (537 bulgunun ~350'si). Notların nerede duracağı Yakup'a soruldu, cevap bekliyor.

- **2026-09-30** — Push kuyruğun işi değil: `default_allowed` bilerek `["merge"]`.
  Merge otomatik, push Yakup'ta. "N commit push bekliyor" bir bulgu değil.

## Kapanmış bulgular

1 Eki 2026:

| Bulgu | Commit |
|---|---|
| A1 — merge'den sonra worktree silinmiyor | #94, `26c324b` / `cf6b823` 1 Eki 11:29 |
| A3 — #30 stale kill, tek vaka | 30 Eyl akşam penceresinde tekrar yok. 1 Eki'deki tek stale kill (#80, 01:26) dolu diskten, bkz. A9 |
| Kartta koşamayan `verify_cmd` Yakup'a gidiyor (#94, `npm test` Python repoda) | `426c001` 1 Eki 12:03 |
| Hermes'in disk bekçisi çalışan ticket'ın worktree'sini siliyor (#86, #93) | karar: Hermes worktree silmez, yalnızca cache |

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
