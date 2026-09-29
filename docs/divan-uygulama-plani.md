# Divan — uygulama planı (tasarımlar geldikten sonra)

Tasarım dosyası: `design/divan/Divan.dc.html` (40+ frame, mobil + web, light ve
dark). Palet yeni: `--bg #131210 / #F5F3EE`, amber vurgu, koşan için yeşil,
kırmızı uyarı. Bugünkü web paleti (`web/src/lib/theme.ts`) tamamen farklı.

**Bu bir re-skin değil, komple yeni bir arayüz.** Her yüzey yeniden yazılıyor.
Tek istisna chat: düzeni beğenildi, ellenmiyor.

Kural: tasarlanmış ekran birebir uygulanır. Tasarlanmamış ekran (eşleştirme,
karşılama, hesaplar, agent store, sheet'ler) işlevini korur ama yeni dile
taşınır — eski paletle ortada kalmaz. Gerçek veriyle çelişen bir şey çıkarsa
sessizce değiştirilmez, ticket'ta not edilir.

## Katman 0 — temel (her şeyi kilitler)

- **T1 · Tasarım sistemi, mobil.** Tokenlar (light+dark) ve primitifler: kart,
  satır, pill, sekme, kolon sekmesi, durum noktası, rozet, boş hal, sheet.
  Ekranlar bunun üstüne kurulacak, yoksa 11 ticket 11 ayrı dil konuşur.
- **T2 · Tasarım sistemi, web.** Aynısı web tarafında; bugün tek temalı olduğu
  için light mode buranın parçası.
- **T3 · Daemon veri modeli.** projects, branches, board kolonları ve sıra,
  ticket'ın iki yüzü + executor + machine, executor kaydı, makine kaydı, kota.
  ustabaşı kuyruğu aynalanır (daemon sahibi, ustabaşı kod executor'ı kalır).
- **T4 · Çoklu makine toplama.** İstemci eşleşmiş her host'a sorup birleştirir;
  her host için "en son ne zaman ulaşıldı" damgası. Sessiz host varsa ekran
  bayat olduğunu söyler.

## Katman 1 — mobil (Expo/RN)

- **T5** Navigasyon iskeleti: Dashboard / Chat / Machine, proje çubuğu; eski
  ekranlar Machine altına iner.
- **T6** Dashboard: sayaçlar, "seni bekleyenler", proje kartları, ajan satırları
  + sistem satırının üç hali (sağlıklı / makine ulaşılamıyor / kota bitti).
- **T7** Waiting on you.
- **T8** Proje sayfası, Overview sekmesi + dal kartları; üç varyant (farklı
  rakamlar, haftalardır ölü proje, yepyeni boş proje).
- **T9** Board sekmesi: dört kolon, kart durumları, makine rozeti, review/failed.
- **T10** Sürükleme: 350 ms basılı tut, kolon sekmeleri drop target, haptik,
  bırakınca ajanın kartı alması. En riskli parça.
- **T11** Ticket: human / agent / live üç yüz + koşan worker'a tek cümle.
- **T12** New ticket.
- **T13** Branch page: jenerik düzen + Engineering yoğun varyantı.
- **T14** Machine: drawer + Machines + Executors.
- **T15** Tasarlanmamış mobil ekranların yeni dile taşınması: pair, welcome,
  accounts, agent store/install, settings, model/host sheet'leri.

## Katman 2 — web

- **T16** Web kabuğu: üç yer, proje çubuğu, light/dark anahtarı.
- **T17** Overview; "needs you" masaüstünde chat oturumu olarak.
- **T18** Board + soran ajanın chat panelinin yanda açılması.
- **T19** Project / Branch / Ticket / New ticket (Ice Box'ın başında satır içi).
- **T20** Machine drawer'ın tamamı: Machines, Executors, Terminals, Remote
  screen, Accounts & sign-ins (süresi dolan), kota eşikleri, Admin, Settings.
- **T21** Web'de tasarlanmamış kalan ekranların yeni dile taşınması.

## Chat

Ellenmiyor. Tasarımdaki chat frame'lerinden sadece iki yeni davranış alınır:
mesajı tek hareketle Ice Box'a ticket yapmak, ve voice mode. Web chat'te light
mode T2'yle gelir. Chat yeni ekranların yanında yabancı durursa o zaman
konuşulur — şimdiden dokunulmaz.

## Kapsam dışı (bilerek)

Dal verilerinin gerçek kaynakları — SEO nightly, PostHog, Sentry, AWS gideri.
Branch sayfaları Engineering'de gerçek veriyle, diğer dallarda "kaynak henüz
bağlı değil" haliyle çıkar. Uydurma rakam gösterilmez. Planın 3. adımı.

## Çalışma düzeni

**Aynı anda tek mobil ajan, tek web ajanı.** İki şerit, her biri seri. Sekiz
slotun hepsini açmak yok: Yakup akan diff'i tek tek görebilsin diye.

- **Core şeridi önce.** T3 ve T4 (daemon modeli, çoklu makine) biter, sonra
  şeritler açılır. T1 ve T2 kendi şeritlerinin ilk ticket'ı.
- **Mobil şerit** sırayla: T1 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 →
  T13 → T14 → T15. Tek mobil ajan koştuğu için simülatör çakışması yok;
  ekran ticket'ı simülatörü kendi kullanabilir.
- **Web şeridi** sırayla: T2 → T16 → T17 → T18 → T19 → T20 → T21.
- **Denetim turu** her üç dört ekranda bir, kendi şeridinin içinde: çerçeveyle
  karşılaştır, light ve dark'ı gez, tutarsızlığı düzelt ya da ekranı geri aç.
- Bedeli açık: iki şeritte seri gitmek altı ajanı aynı anda koşturmaktan
  belirgin şekilde uzun sürer. Karşılığı okunabilir diff ve erken yakalanan
  hata.

## ustabaşına gereken iki küçük ekleme

Bugün sadece sekiz slot ve öncelik sırası var; "şu ticket şundan sonra" ve
"bu şeritte aynı anda tek ticket" denemiyor (`ustabasi/db.py`'da bağımlılık
alanı yok, `config.json` tek sayı).

1. **Şerit (lane)** alanı: ticket bir şerit ilan eder, şerit başına tek ticket
   koşar. Tekil kaynak kilidi de bu.
2. **Bağımlılık ya da beklemeye alma**: bir ticket bitmeden diğeri sıraya
   girmesin.

## Durum

28 Eyl 2026: plan hazır, **ticket açılmadı**. Yakup "şimdilik başlama, sadece
planla" dedi.
