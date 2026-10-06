"""Write app/scripts/fixtures/tts-frontend.json: EMA's own frontend and chunker on a fixed set of inputs.

    .venv/bin/python frontend_fixture.py

The app's TypeScript port (app/src/tts/) is checked against this file by `npm test`, which has no Python;
so this script is not run by the tests and its output is committed. Re-run it after changing INPUTS or
upgrading ema-lightning / normalizer-tr, and commit the result.
"""
import json
from importlib.metadata import version
from pathlib import Path

from ema_lightning.chunker import chunk
from ema_lightning.frontend import Frontend

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "app" / "scripts" / "fixtures" / "tts-frontend.json"
VOCAB = json.loads((HERE / "vectors.json").read_text())["vocab"]

# (category, text). Categories with a fixed bar in the ticket: number, date, time, money, percent.
INPUTS = [
    # cardinal, ordinal and decimal numbers
    ("number", "Kuyrukta 3 ticket var."),
    ("number", "0"),
    ("number", "Toplam 17 dosya değişti."),
    ("number", "Bu yıl 2026 oldu."),
    ("number", "Sayı 1000000 oldu."),
    ("number", "1.234.567 kişi izledi."),
    ("number", "Rakam 1.234 civarında."),
    ("number", "Ekipte 101 kişi var."),
    ("number", "Sıcaklık -5 derece."),
    ("number", "Fark +12 puan."),
    ("number", "Oran 3,14 çıktı."),
    ("number", "Değer 0,05 oldu."),
    ("number", "Ortalama 12,5 dakika."),
    ("number", "Sonuç -0,75 geldi."),
    ("number", "Yarışmada 1. oldu."),
    ("number", "Sınıfta 3.'yü aldı."),
    ("number", "5'inci sırada bekliyor."),
    ("number", "10'uncu deneme başarılı."),
    ("number", "Saat geldi, 2'de çıkıyoruz."),
    ("number", "3'e kadar say."),
    ("number", "Bunu 5'ten önce bitir."),
    ("number", "6'yı seçtim."),
    ("number", "40'ın yarısı 20'dir."),
    ("number", "Toplam 25."),
    ("number", "Sayfa 007 açıldı."),
    ("number", "Uzunluk 999999999999999999 birim."),
    ("number", "Kod 1,2345678901 oldu."),
    ("number", "1.'nin ödülü büyük."),
    ("number", "100'den fazla hata var."),
    ("number", "Bölüm 4'ün sonu."),
    ("number", "İkinci sürüm 2.0 çıktı."),
    ("number", "1.000.000'dan fazla."),
    # dates
    ("date", "Toplantı tarihi 15.10.2026 olarak belirlendi."),
    ("date", "15.10.2026"),
    ("date", "Tarih: 01.01.2027 için plan."),
    ("date", "Teslim tarihi 3.5.2026 olacak."),
    ("date", "Tarih 2026-10-15 olarak girildi."),
    ("date", "Son gün 29.02.2028 tarihi."),
    ("date", "15.10.2026'da görüşürüz."),
    ("date", "15.10.2026'da saat 14:30'da buluşalım."),
    ("date", "Tarih 31.04.2026 geçersiz."),
    ("date", "Fatura tarihi 28.02.2026 idi."),
    ("date", "2026-10-15 günü deploy var."),
    ("date", "Tarih: 07.10.2026"),
    ("date", "Toplantı 14 Mart 2026 Cuma günü."),
    ("date", "1.1.2030 tarihi çok uzak."),
    ("date", "Tarihi 12.12.2012 olan kayıt."),
    # times, with and without a case suffix
    ("time", "Saat 14:30'da toplantı var."),
    ("time", "Saat 09:30'da başlıyoruz."),
    ("time", "Saat 10:00'da görüşürüz."),
    ("time", "Saat 15:40'ta çıkıyorum."),
    ("time", "Saat 08:05'te uyandım."),
    ("time", "Saat 12:20'de yemek."),
    ("time", "Saat 23:59'da kapanıyor."),
    ("time", "Saat 00:00'da sıfırlanır."),
    ("time", "Saat 17:45'te bitiyor."),
    ("time", "Saat 06:03'te tren kalkar."),
    ("time", "Saat 11:11'de dilek tut."),
    ("time", "Saat 13:00'te buluşalım."),
    ("time", "14:30'da toplantı var."),
    ("time", "Saat 14:30 civarı uygun."),
    ("time", "Saat 9.15'te başlar."),
    ("time", "Saat: 18:00 itibarıyla kapalı."),
    ("time", "Saat 24:10'da imkânsız."),
    ("time", "Build 03:02'de bitti."),
    ("time", "Saat 07:50'de kalkış."),
    ("time", "Saat 19:30'da konser başlıyor."),
    # money
    ("money", "Fatura 1.250 TL geldi."),
    ("money", "Toplam 25 TL."),
    ("money", "Fiyatı 1.250,75 TL oldu."),
    ("money", "Ücret ₺450 olarak güncellendi."),
    ("money", "Bu ay $1.200 harcadık."),
    ("money", "Bilet 35 € tuttu."),
    ("money", "Kira 12.500 TL'den 15.000 TL'ye çıktı."),
    ("money", "Abonelik 9,99 USD."),
    ("money", "Toplam 100 EUR ödendi."),
    ("money", "Bağış 50 GBP oldu."),
    ("money", "Bütçe 25 TL'den az."),
    ("money", "Bahşiş 0,50 TL bıraktık."),
    ("money", "Fiyat 3$ civarı."),
    ("money", "Fiyat 20€ oldu."),
    ("money", "Fiyatı 1.250,5 TL."),
    ("money", "Kurs 30 TRY."),
    ("money", "Maliyet -15 TL çıktı."),
    ("money", "£12 ödedim."),
    ("money", "Toplam 1.000.000 TL'yi geçti."),
    ("money", "Aylık 99 TL'lik paket."),
    # percentages
    ("percent", "Pil %85 dolu."),
    ("percent", "%12,5'lik fark var."),
    ("percent", "İndirim %20."),
    ("percent", "%100 emin değilim."),
    ("percent", "Oran %37,5'lik."),
    ("percent", "%3,25'ten düştü."),
    ("percent", "Sunucu %90'a çıktı."),
    ("percent", "%50'si tamam."),
    ("percent", "%0 hata."),
    ("percent", "Test kapsamı %73."),
    ("percent", "%40'tan fazla."),
    ("percent", "Yük %5'te kaldı."),
    ("percent", "Başarı %99,9."),
    ("percent", "%60'lık dilim."),
    # units and rates
    ("unit", "5 kg malzeme."),
    ("unit", "Mesafe 12 km."),
    ("unit", "Boyu 180 cm."),
    ("unit", "2 L su iç."),
    ("unit", "Hız 90 km/sa."),
    ("unit", "Rüzgâr 5 m/s esiyor."),
    ("unit", "Bekleme 15 dk sürdü."),
    ("unit", "Yanıt 30 sn içinde."),
    ("unit", "Daire 120 m² büyüklükte."),
    ("unit", "Dozu 500 mg."),
    ("unit", "Bellek 2,5 GB kullanıldı."),
    ("unit", "250 ml süt ekle."),
    ("unit", "10-15 kişi gelecek."),
    ("unit", "3-5 gün sürer."),
    ("unit", "5 kg'dan fazla."),
    ("unit", "Hacim 3 m³."),
    # abbreviations and initialisms
    ("abbreviation", "Dr. Ayşe Hanım bekliyor."),
    ("abbreviation", "Prof. Yılmaz konuşacak."),
    ("abbreviation", "Elma, armut vb. meyveler."),
    ("abbreviation", "TBMM toplandı."),
    ("abbreviation", "PTT'den kargo geldi."),
    ("abbreviation", "NATO zirvesi yapıldı."),
    ("abbreviation", "IBAN numarasını gönder."),
    ("abbreviation", "Fiyata KDV dahil."),
    ("abbreviation", "API yanıt vermiyor."),
    ("abbreviation", "PR açıldı, CI yeşil."),
    ("abbreviation", "Yeni iOS sürümü."),
    ("abbreviation", "THY uçağı indi."),
    ("abbreviation", "Dr.'a sor."),
    # symbols, electronic text, identifiers
    ("symbol", "Ali & Veli geldi."),
    ("symbol", "#ustabasi etiketi."),
    ("symbol", "Durum: ✓ tamam."),
    ("symbol", "A → B geçişi."),
    ("symbol", "Not: 2 + 2 = 4"),
    ("symbol", "Sıcaklık 25°C civarı."),
    ("symbol", "Puan 4,5/5."),
    ("symbol", "Harika :) teşekkürler."),
    ("symbol", "Değer ≈ 3."),
    ("symbol", "Mail at: yakup@example.com"),
    ("symbol", "Siteye bak: https://example.com/docs"),
    ("symbol", "www.google.com adresine gir."),
    ("symbol", "Web yakupkeskin.dev üzerinde."),
    ("symbol", "Telefon 0532 123 45 67 numarası."),
    ("symbol", "Ara: +90 532 123 45 67"),
    ("symbol", "Sürüm v2.1.3 yayında."),
    ("symbol", "Ticket #120 bitti."),
    ("symbol", "II. Dünya Savaşı bitti."),
    ("symbol", "XIX. yüzyıl romanı."),
    ("symbol", "Bölüm IV başladı."),
    ("symbol", "C++ ve C# dilleri."),
    ("symbol", "Dosya_adi_v2 bulundu."),
    ("symbol", "E-posta: test.user@site.com.tr"),
    ("symbol", "“Merhaba” dedi… sonra gitti."),
    ("symbol", "Değer: 5 × 3."),
    ("symbol", "x = y"),
    ("symbol", "Hata kodu E404."),
    ("symbol", "Port 8080'de çalışıyor."),
    # ordinary prose in the voice call's style
    ("prose", "Kuyrukta üç ticket var."),
    ("prose", "Tamam, hemen bakıyorum."),
    ("prose", "Testler geçti, birleştirmeye hazır."),
    ("prose", "Yüz yirmi numaralı ticket bitti."),
    ("prose", "Şu an iki iş çalışıyor, biri bekliyor."),
    ("prose", "Derleme başarısız oldu, logu okuyorum."),
    ("prose", "Gece nöbeti raporu hazır."),
    ("prose", "İSTANBUL'DA HAVA GÜZEL."),
    ("prose", "Iğdır ve Işık köyü."),
    ("prose", "Çok güzel, öğle yemeğinden sonra şöyle bir göz atarım."),
    ("prose", "Café'de buluşalım, naïve bir fikir."),
    ("prose", "Bu commit'i geri alalım mı?"),
    ("prose", "Yakup, onay bekleyen bir soru var: hangi hesabı kullanalım?"),
    ("prose", "Hepsi bu kadar!"),
    ("prose", "Evet... belki de hayır."),
    ("prose", "Merhaba—nasılsın?"),
    ("prose", "Ne dersin; devam mı, dur mu?"),
    ("prose", "Sunucu ayakta (kontrol ettim)."),
    ("prose", "\"Bitti\" dedi ve çıktı."),
    ("prose", "Ajanın işi bitti; doğrulayıcı onayladı."),
    ("prose", "Pull request açık, inceleme bekliyor."),
    ("prose", "Bir sorun yok gibi görünüyor."),
    ("prose", "Tamamdır, kapatıyorum."),
    ("prose", "Kuyruk boş."),
    ("prose", "Ses kaydı geldi, dinliyorum."),
    ("prose", "  boşluklu   metin \t ve\nsatır  "),
    ("prose", ""),
    ("prose", "   "),
    ("prose", "日本語 karışık metin."),
    ("prose", "Emoji 🙂 ve 🚀 içerir."),
    ("prose", "İyi geceler, yarın görüşürüz."),
    ("prose", "Ağaç, öğün, ışık, çiçek, şeker, üzüm."),
    # mixed
    ("mixed", "Toplantı 14 Mart 2026 Cuma günü saat 15:30'da başlayacak."),
    ("mixed", "Fatura tutarı 1.250,75 TL, son ödeme tarihi 3 Ekim."),
    ("mixed", "Sunucu son 5 dakikada %85 yükte çalıştı ve 2,5 GB bellek kullandı."),
    ("mixed", "1999 yılının 17 Ağustos gecesi saat 03:02'de büyük bir deprem oldu."),
    ("mixed", "saat 09:30'da 5 kg malzeme ve %12,5'lik fark"),
    ("mixed", "Kuyrukta 3 ticket var, 2'si çalışıyor ve 1'i %50'de."),
    ("mixed", "Tarih 15.10.2026, saat 14:30, tutar 1.250 TL."),
    ("mixed", "#118 ve #119 birleşti, #120 sırada."),
]

PARAGRAPH = (
    "Gece boyunca kuyrukta yedi ticket vardı ve hepsi sırayla çalıştı. İlk ikisi kısa işlerdi, birer "
    "saatte bitti; üçüncüsü telefondaki ses modelini çeviren işti ve doğrulayıcı onu iki kez geri "
    "gönderdi, çünkü test vektörleri eksikti. Sonunda vektörler eklendi, kontroller geçti ve iş sabaha "
    "karşı birleştirildi. Dördüncü ticket hâlâ bekliyor: hangi hesabın kullanılacağına senin karar "
    "vermen gerekiyor. Beşinci ve altıncı işler arayüzle ilgiliydi, ekran görüntüleri hazır, istersen "
    "bakabilirsin. Yedincisi ise sadece bir yazım hatasıydı ve birkaç dakikada kapandı, başka bir şey yok. Yarın saat 09:30'da kısa bir toplantı var."
)

CHUNKS = [
    (PARAGRAPH, 1.0),
    (PARAGRAPH, 1.5),
    (PARAGRAPH, 0.8),
    ("Fatura 1.250,75 TL geldi, son ödeme tarihi 15.10.2026 olarak görünüyor; sunucu son 5 dakikada %85 "
     "yükte çalıştı ve 2,5 GB bellek kullandı. " * 3, 1.0),
    ("Kısa bir cümle.", 1.0),
    ("virgülle biten, uzun olmayan bir parça,", 1.0),
    ("bitmeyen bir cümle", 1.0),
    ("a" * 300, 1.0),
    (("kelime " * 60).strip(), 1.0),
    ("Bir, iki, üç, dört, beş, altı, yedi, sekiz, dokuz, on, on bir, on iki, on üç, on dört, on beş, "
     "on altı, on yedi, on sekiz, on dokuz, yirmi, yirmi bir, yirmi iki, yirmi üç, yirmi dört, yirmi beş, "
     "yirmi altı, yirmi yedi.", 1.0),
    ("\"Tamam.\" dedi. \"Gidiyorum!\" diye ekledi ve kapıyı kapattı; sonra uzun bir süre hiçbir şey "
     "olmadı, sadece rüzgâr esti ve yapraklar düştü. Ertesi sabah herkes erkenden kalktı, kahvaltı "
     "hazırlandı ve yolculuk başladı. Yol boyunca kimse konuşmadı...", 1.0),
    ("... ? !", 1.0),
    ("", 1.0),
]


def main():
    frontend = Frontend(VOCAB)
    stoi = {ch: i for i, ch in enumerate(VOCAB)}
    cases = []
    for category, text in INPUTS:
        spoken = frontend(text)
        cases.append({"category": category, "text": text, "spoken": spoken,
                      "ids": [stoi.get(ch, 1) for ch in spoken]})
    chunks = []
    for text, speed in CHUNKS:
        spoken = frontend(text)
        chunks.append({"text": text, "speed": speed, "spoken": spoken,
                       "pieces": [[piece, pause] for piece, pause in chunk(spoken, speed)]})
    data = {
        "about": "EMA Lightning frontend (normalizer-tr, fallback policy) and chunker output: regenerate with "
                 "tts/frontend_fixture.py. Checked by app/scripts/test-tts.cjs.",
        "versions": {"ema-lightning": version("ema-lightning"), "normalizer-tr": version("normalizer-tr")},
        "cases": cases,
        "chunks": chunks,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(cases)} cases, {len(chunks)} chunk inputs -> {OUT}")


if __name__ == "__main__":
    main()
