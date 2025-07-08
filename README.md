# Siirt Rota Optimizasyonu

Bu proje, Siirt ilindeki rota optimizasyonunu sağlamak amacıyla geliştirilmiş bir yazılım sistemidir. Proje üç ana bileşenden oluşmaktadır:

- **automation/**: Harita otomasyon işlemlerini gerçekleştiren Python betikleri ve bağımlılıkları içerir.
- **backend/**: Rota veritabanı ve sunucu tarafı işlemlerini yöneten Node.js tabanlı arka uç uygulamasıdır.
- **frontend/**: Kullanıcı arayüzünü sağlayan HTML, CSS ve JavaScript dosyalarını içerir.

## Klasör Yapısı

```
automation/
  Maps_automator.py
  requirements.txt
backend/
  package.json
  server.js
  siirt_routes.db
frontend/
  index.html
  script.js
  style.css
```

## Kurulum ve Çalıştırma

### 1. Otomasyon (Python)

```bash
# Gerekli paketleri yükleyin
pip install -r automation/requirements.txt
# Otomasyon betiğini çalıştırın
python automation/Maps_automator.py
```

### 2. Backend (Node.js)

```powershell
# Gerekli paketleri yükleyin
cd backend
npm install
# Sunucuyu başlatın
node server.js
```

### 3. Frontend

`frontend/index.html` dosyasını bir tarayıcıda açarak arayüze erişebilirsiniz.

## Özellikler
- Rota optimizasyonu ve harita otomasyonu
- Web tabanlı kullanıcı arayüzü
- Node.js tabanlı API ve veritabanı yönetimi

## Katkıda Bulunma
Katkıda bulunmak için lütfen bir fork oluşturun ve pull request gönderin.

## Lisans
Bu proje MIT lisansı ile lisanslanmıştır.
