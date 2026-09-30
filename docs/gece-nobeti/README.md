# Gece nöbeti

`nightly-ticket-review` skill'inin hafızası. Her gece `YYYY-MM-DD.md` altında o günün
notu; bu dosya açık bulguları, Yakup'un kararlarını ve "bir daha söyleme" dediklerini
taşır. Yeni bir gece eski bir bulguyu yeniden keşfetmez — burada varsa "şu tarihten
beri açık" diye bir kez anılır.

## Nöbet tutarken

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
| A1 | Merge'den sonra worktree silinmiyor: 9.8 GB, 8.3 GB'ı `done` ticket'larda; `clean` yalnızca CLI'da, supervisor çağırmıyor | 2026-09-30 | Yakup'a soruldu |
| A2 | Kapasite: 24 saatte 218 koşu / $1752, yakup 2 Ekim 10:02'ye kadar kapalı, kuyruk tek hesapta yedeksiz | 2026-09-30 | Yakup'a soruldu |
| A3 | #30 stale kill (20 dk çıktısız, 29 Eyl 16:12) — tek vaka, desen değil | 2026-09-30 | izlemede |

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
