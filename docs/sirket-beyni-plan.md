# Divan — plan (canlı not)

remote-ai-chat'i "makineye bağlanma aracı"ndan çıkarıp tüm projelerin
yönetildiği tek yüzeye çevirme planı. Sohbet restart'larında kaybolmasın
diye buraya yazılıyor. Karar verildikçe güncellenir.

**Ürünün adı: Divan.** Divan, imparatorluğun fiilen yönetildiği oda. İşi
ustabaşı yapar, durumu Hermes getirir, karar Divan'da verilir.

## Teşhis

Bugünkü sekmeler makine ve oturum etrafında kurulu (Chats, Terminal, Screen,
Panel, Agents, Admin, Settings). Proje şeklinde olan iki ekran var ama ikisi de
ikincil: ustabaşı duvarı Terminal'in içinde bir alt sekme (Terminal.tsx:651),
Projects ekranı klasörleri git durumuyla listeliyor. Hiyerarşi ters: en üstte
makine var, proje onun altında. Beyin olması = bunun tersine dönmesi.

## Kararlar (kesin)

1. **Proje = ürün, klasör değil.** isghocam bir üründür; teknik, SEO, analytics,
   pazarlama, müşteriye ulaşma onun dallarıdır. Repo teknik dalın bir detayı.
2. **Sormak zorunda kaldığın her şey ekran olur.** Chat istisna: sadece
   müdahale edilecekse girilir. "Durum ne" diye sorulmaz, bakılır.
3. **Dashboard** açılış ekranı: tüm projeler sıra sıra + o an hangi executor
   hangi projenin hangi ticket'ında, statüsüyle. Projeye tıklayınca o projeye
   iner.
4. **Proje sayfası** = dal kartları (her biri tek satır durum + 2-3 sayı + son
   tazelenme). Üstte tek satır "şu an ne oluyor" ve "seni bekleyenler".
5. **Board** her projeye ait: Ice Box / Sırada / In Progress / Bitti,
   sürükle-bırak. In Progress'e bırakmak = "başla" demek, executor alır.
6. **Kolon niyet, statü gerçek.** Kartı sen taşırsın; worker'ın alması,
   takılması, verifier'ın geçmesi kartın üstünde işaret olarak görünür.
   Ticket başına "kendi kendine ilerle" ayarı var, **varsayılan kapalı**.
   Kapalı modda bile soru sorulursa bildirim + kırmızı işaret çıkar.
7. **Ticket iki yüzlü doğar.** İnsan yüzü: başlık (tek satır) + 2-3 cümle
   "ne yapılacak", başka hiçbir şey; alan fiziksel olarak dar. Ajan yüzü:
   hedef, bitti kriterleri, test komutu, kısıtlar, dosya yolları, ustabaşıya
   yorumlar; istenildiği kadar uzun, varsayılan kapalı. Ajanın ürettiği metin
   asla insan yüzüne düşmez. Sürükleyince yazılacak bir şey kalmadığı için
   onay ekranı da yok.
8. **İnsan tarafında stop yok.** Ne ticket açarken ne ajanla konuşurken 20
   paragraflık onay ekranı. Sana gelen soru tek satır, tek cümle, insanın
   cevaplayabileceği biçimde.
9. **Her ticket'ın bir executor'ı var.** Dört tip: ustabaşı (kod), dal ajanı
   (SEO/pazarlama/müşteri — gece koşup dalı ilerleten), Hermes (tek seferlik
   araştırma/metin), Yakup. Yakup'un üstündeki ticket'ta koşan bir şey olmaz,
   kart "sende" işareti alır ve "seni bekleyenler"de durur. Executor boş
   açılabilir; In Progress'e sürüklerken boşsa platform tahmin edip tek
   dokunuşla sorar. Ajan executor'lar ticket **açabilir ama sadece Ice Box'a** —
   SEO ajanı gece bulduğu işi kart olarak bırakır, sabah Yakup sürükler.
10. **Takvim yok.** Planlama = sıra: "Sırada" kolonu yukarıdan aşağı öncelik.
   Tarih sadece gerçekten tarihi olan işlerde opsiyonel alan (lansman, SES
   production access); haftalık takvim görünümü yapılmayacak.
11. **Board verisi daemon'ın kendi DB'sinde.** Projeler, dallar, kolonlar, sıra,
   iki yüz, executor orada. ustabaşı kod executor'ı olarak kalır; daemon onun
   durumunu aynalar, tersi değil.

12. **Navigasyon üç sekme:** Dashboard / Chat / Makine. Terminal, Screen,
   Panel, Agents, Admin, Settings hepsi Makine'nin altına iner.
13. **Tek chat.** Yakup dışarıdan her zaman Hermes'le, tek bir sohbette
   konuşur; proje seçmez, sohbet açmaz. Gruplama Hermes'in işi: konuşulan
   şeye göre projeyi kendi belirler, konuşmayı o projeye etiketler, proje
   sayfasında "son konuşmalar" olarak görünür. Bunun şartı proje başına
   çalışma hafızası: konu isghocam'a dönünce Hermes isghocam hafızasını
   yükler, görünen şerit tek kalır.
14. **Chat'ten ticket.** Konuşurken çıkan iş Ice Box'a kart olarak düşer,
   onay sorulmadan — Ice Box iş başlatmaz. Başlatan tek şey sürüklemek.

## Açık başlıklar

- Mevcut sekmelerin (Terminal/Screen/Panel/Agents) nereye çekileceği
- Dal verilerinin kaynakları: PostHog, Sentry, SEO nightly, git, ustabaşı
