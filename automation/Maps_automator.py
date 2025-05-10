import time
import requests
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError, Page, Locator

# --- Ayarlar ---
BACKEND_URL_LATEST_ROUTE = "http://localhost:3000/api/routes/latest"
Maps_URL = "https://www.google.com/maps"
DEFAULT_TIMEOUT = 30000  # Milisaniye cinsinden (30 saniye)
SHORT_DELAY = 1  # Saniye cinsinden kısa beklemeler
MEDIUM_DELAY = 3  # Saniye cinsinden orta beklemeler

# --- Yardımcı Fonksiyonlar ---
def fetch_latest_route():
    """Backend'den en son kaydedilen rotayı çeker."""
    try:
        response = requests.get(BACKEND_URL_LATEST_ROUTE, timeout=10)
        response.raise_for_status()  # HTTP hataları için exception fırlatır
        data = response.json()
        route_points = data.get("route")
        if not route_points:
            print("Backend'den rota alınamadı veya rota boş.")
            return None
        print(f"Backend'den {len(route_points)} noktalı rota başarıyla alındı (Oturum ID: {data.get('sessionId')}).")
        return route_points
    except requests.exceptions.RequestException as e:
        print(f"Backend'e bağlanırken hata oluştu: {e}")
        return None
    except Exception as e:
        print(f"Rota verisi işlenirken bir hata oluştu: {e}")
        return None

def accept_cookies_if_present(page: Page):
    """Google Haritalar'da çerez kabul etme butonunu bulup tıklar (varsa)."""
    try:
        cookie_button_selectors = [
            "button[aria-label='Accept all']",
            "button[aria-label='Tümünü kabul et']",
            "form:has-text('Before you continue to Google Maps') >> text=Accept all",
            "form:has-text('Google Haritalar\\'a devam etmeden önce') >> text=Tümünü kabul et",  # Kesme işareti escape edildi
            "div[role='dialog'] >> text=/Accept all|Tümünü kabul et/i"
        ]
        
        for selector in cookie_button_selectors:
            # query_selector yerine locator kullanmak genellikle daha iyidir, otomatik bekleme sağlar.
            button = page.locator(selector).first  # İlk eşleşeni al
            if button.is_visible(timeout=5000):  # 5 saniye içinde görünür mü diye bak
                print("Çerez kabul etme butonu bulundu, tıklanıyor...")
                button.click()
                page.wait_for_timeout(SHORT_DELAY * 1000) 
                print("Çerezler kabul edildi.")
                return True
        print("Çerez kabul etme butonu bulunamadı veya görünür değil.")
        return False
    except PlaywrightTimeoutError:
        print("Çerez kabul etme butonu aranırken zaman aşımı.")
        return False
    except Exception as e:
        print(f"Çerez kabul etme sırasında hata: {e}")
        return False

def search_location(page: Page, location_query: str, input_placeholder: str = "Haritalarda arama yapın"):
    """Belirtilen konumu arama kutusuna yazar ve Enter'a basar."""
    try:
        print(f"Konum aranıyor: {location_query}")
        search_box_selector = f"input[aria-label='{input_placeholder}'], input[title='{input_placeholder}'], input[placeholder='{input_placeholder}'], #searchboxinput"
        
        search_input = page.locator(search_box_selector).first
        search_input.wait_for(state="visible", timeout=DEFAULT_TIMEOUT)  # Bekleme ekledim
        
        search_input.fill(location_query)
        time.sleep(SHORT_DELAY) 
        page.keyboard.press("Enter")
        print(f"'{location_query}' için Enter basıldı.")
        page.wait_for_timeout(MEDIUM_DELAY * 1000) 
        return True
    except PlaywrightTimeoutError:
        print(f"Arama kutusu ('{input_placeholder}') bulunamadı veya zaman aşımı.")
        return False
    except Exception as e:
        print(f"Konum arama sırasında hata ({location_query}): {e}")
        return False

def click_directions_button(page: Page):
    """Yol Tarifi butonuna tıklar."""
    try:
        print("Yol Tarifi butonu aranıyor...")
        directions_button_selector = "button[aria-label*='Directions to'], button[data-value*='Directions'], button:has-text('Yol Tarifi')"
        
        directions_button = page.locator(directions_button_selector).first
        directions_button.wait_for(state="visible", timeout=DEFAULT_TIMEOUT)
        directions_button.click()
        print("Yol Tarifi butonuna tıklandı.")
        page.wait_for_timeout(MEDIUM_DELAY * 1000) 
        return True
    except PlaywrightTimeoutError:
        print("Yol Tarifi butonu bulunamadı veya zaman aşımı.")
        return False
    except Exception as e:
        print(f"Yol Tarifi butonuna tıklarken hata: {e}")
        return False

def input_origin_destination(page: Page, location_str: str, input_index: int):
    """Yol tarifi arayüzünde başlangıç veya hedef noktasını girer."""
    try:
        print(f"{input_index}. girdi ({('Başlangıç' if input_index == 0 else 'Hedef')}) için konum giriliyor: {location_str}")
        
        input_selectors_base = "div[id^='directions-searchbox-'] input"  # Genel seçici
        all_direction_inputs: Locator = page.locator(input_selectors_base)
        
        target_input: Locator
        # Beklenen input sayısı için kısa bir bekleme
        try:
            # En az (input_index + 1) kadar input alanı olmasını bekle
            page.wait_for_function(f"() => document.querySelectorAll(\"{input_selectors_base}\").length > {input_index}", timeout=10000)
        except PlaywrightTimeoutError:
            print(f"Uyarı: {input_index}. hedef için yeterli sayıda giriş kutusu zamanında oluşmadı.")
            # Eğer beklenen sayıda kutu yoksa ve bu ilk hedefse (örn. index 1), hata ver.
            if input_index > 0 and all_direction_inputs.count() <= input_index:
                print(f"Hata: {input_index}. hedef için giriş kutusu bulunamadı.")
                return False

        if all_direction_inputs.count() > input_index:
            target_input = all_direction_inputs.nth(input_index)
        else:
            # Bu durum genellikle 'Hedef ekle' sonrası yeni kutunun hemen bulunamamasıyla ilgili olabilir
            # veya beklenenden az kutu varsa. Sonuncuyu deneyebiliriz ama riskli.
            print(f"Uyarı: {input_index}. hedef için spesifik giriş kutusu bulunamadı. Bulunan son kutu deneniyor.")
            if all_direction_inputs.count() == 0:
                print(f"Hata: Hiç yönlendirme giriş kutusu bulunamadı.")
                return False
            target_input = all_direction_inputs.last
        
        target_input.wait_for(state="visible", timeout=DEFAULT_TIMEOUT)
        target_input.fill(location_str)
        time.sleep(SHORT_DELAY)
        page.keyboard.press("Enter") 
        print(f"'{location_str}' için Enter basıldı ({input_index}. girdi).")
        page.wait_for_timeout(MEDIUM_DELAY * 1000) 
        return True

    except PlaywrightTimeoutError:
        print(f"{input_index}. girdi için konum kutusu bulunamadı veya zaman aşımı.")
        return False
    except Exception as e:
        print(f"{input_index}. girdi için konum girilirken hata ({location_str}): {e}")
        return False

def click_add_destination_button(page: Page):
    """'Hedef ekle' butonuna tıklar."""
    try:
        print("'Hedef ekle' butonu aranıyor...")
        add_destination_selector = "button[aria-label*='Add destination'], button[aria-label*='Hedef ekle'], button:has-text('+'), button[jsaction*='addStop']"
        
        add_button = page.locator(add_destination_selector).first
        add_button.wait_for(state="visible", timeout=DEFAULT_TIMEOUT)
        add_button.click()
        print("'Hedef ekle' butonuna tıklandı.")
        # Yeni input alanının DOM'a eklenmesi için biraz bekle
        page.wait_for_timeout(MEDIUM_DELAY * 1000) 
        return True
    except PlaywrightTimeoutError:
        print("'Hedef ekle' butonu bulunamadı veya zaman aşımı.")
        return False
    except Exception as e:
        print(f"'Hedef ekle' butonuna tıklarken hata: {e}")
        return False

def click_send_to_phone_button(page: Page):
    """"Yol tarifini telefona gönder" butonuna tıklar."""
    try:
        print("'Telefona Gönder' butonu aranıyor...")
        send_to_phone_selectors = [
            "button[aria-label*='Send directions to your phone']",
            "button[aria-label*='Yol tarifini telefonunuza gönderin']",
            "button[data-tooltip*='Send to your phone']",
            "button[data-iduría*='send_to_device']",  # Google'ın kullandığı özel bir attribute olabilir
            "button:has([aria-label*='phone'])" 
        ]
        
        found_button = None
        for selector in send_to_phone_selectors:
            button_locator = page.locator(selector).first
            try:
                if button_locator.is_visible(timeout=5000): 
                    found_button = button_locator
                    break
            except PlaywrightTimeoutError:
                continue  # Bu seçiciyle bulunamadı, sonrakini dene
        
        if found_button:
            print("'Telefona Gönder' butonu bulundu, tıklanıyor...")
            found_button.click()
            page.wait_for_timeout(MEDIUM_DELAY * 1000) 
            print("'Telefona Gönder' butonuna tıklandı. Sonraki adımlar manuel gerekebilir veya ek otomasyon yazılmalıdır.")
            return True
        else:
            print("'Telefona Gönder' butonu bulunamadı veya görünür değil.")
            return False
            
    except PlaywrightTimeoutError:
        print("'Telefona Gönder' butonu aranırken zaman aşımı.")
        return False
    except Exception as e:
        print(f"'Telefona Gönder' butonuna tıklarken hata: {e}")
        return False

# --- Ana Otomasyon Mantığı ---
def ensure_browser_installed():
    """Gerekli tarayıcının yüklü olup olmadığını kontrol eder, değilse yüklemeyi dener."""
    import os
    import subprocess
    import sys
    
    # Chromium tarayıcısının beklenen yolu (Windows için)
    browser_path = os.path.expanduser("~\\AppData\\Local\\ms-playwright\\chromium-1169\\chrome-win\\chrome.exe")
    
    if not os.path.exists(browser_path):
        print("Playwright tarayıcıları yüklü değil. Yükleniyor...")
        try:
            # Playwright tarayıcılarını yükle
            result = subprocess.run(
                [sys.executable, "-m", "playwright", "install", "chromium"],
                capture_output=True,
                text=True,
                check=True
            )
            print("Tarayıcı başarıyla yüklendi.")
            return True
        except subprocess.CalledProcessError as e:
            print(f"Tarayıcı yüklenirken hata oluştu: {e}")
            print(f"Çıktı: {e.stdout}")
            print(f"Hata: {e.stderr}")
            print("Lütfen manuel olarak 'playwright install' komutunu çalıştırın.")
            return False
    return True

def main_automation():
    route_points = fetch_latest_route()
    if not route_points or len(route_points) < 2: 
        print("Otomasyon için yeterli rota noktası bulunamadı. Program sonlandırılıyor.")
        return

    # Tarayıcı kontrolü yap
    if not ensure_browser_installed():
        print("Tarayıcı yüklü olmadığından otomasyon sonlandırılıyor.")
        return

    formatted_locations = [f"{p['coords'][1]}, {p['coords'][0]}" for p in route_points]

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,  # <-- DEĞİŞİKLİK BURADA
            slow_mo=500      # slow_mo değerini biraz artırarak işlemleri daha rahat takip edebilirsin
        ) 
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36"
            # Gerekirse viewport ayarı da ekleyebilirsin, özellikle headless=False olduğunda pencere boyutunu belirlemek için
            # viewport={'width': 1280, 'height': 720} 
        )
        page = context.new_page()
        page.set_default_timeout(DEFAULT_TIMEOUT)  # 30 saniye

        try:
            print(f"Google Haritalar'a gidiliyor: {Maps_URL}")
            # wait_until="networkidle" daha stabil olabilir, tüm ağ isteklerinin bitmesini bekler
            page.goto(Maps_URL, wait_until="networkidle", timeout=60000)  # Timeout'u artırdım

            accept_cookies_if_present(page)
            
            # İlk konumu ara
            if formatted_locations:
                # İlk noktayı arama kutusuna gir ve bul
                search_location(page, formatted_locations[0])
                
                # Yol tarifi butonuna tıkla
                click_directions_button(page)
                
                # İlk konumu (başlangıç) gir
                input_origin_destination(page, formatted_locations[0], 0)
                
                # İkinci noktayı (ilk hedef) gir
                if len(formatted_locations) > 1:
                    input_origin_destination(page, formatted_locations[1], 1)
                
                # 2'den fazla nokta varsa ekstra hedefler ekle
                for i in range(2, len(formatted_locations)):
                    click_add_destination_button(page)
                    input_origin_destination(page, formatted_locations[i], i)
                
                # İsteğe bağlı: Telefona gönder butonuna tıkla
                # click_send_to_phone_button(page)
                
                print("Rota başarıyla Google Haritalar'a yüklendi.")
            else:
                print("Rota koordinatları formatlanamadı.")

        except PlaywrightTimeoutError as pte:
            print(f"Playwright zaman aşımı hatası: {pte}")
            page.screenshot(path="playwright_timeout_error.png")  # Hata anında ekran görüntüsü al
        except Exception as e:
            print(f"Otomasyon sırasında genel bir hata oluştu: {e}")
            page.screenshot(path="playwright_general_error.png")  # Hata anında ekran görüntüsü al
        finally:
            print("Tarayıcıyı kapatmak için 'q' yazıp Enter'a basın veya 15 saniye bekleyin.")
            # Kullanıcının tarayıcıyı incelemesi için bekleme veya input ile kapatma
            # try:
            #     input("Tarayıcıyı kapatmak için Enter'a basın...")
            # except KeyboardInterrupt:
            #     pass
            time.sleep(15)  # Ya da sadece bekleme süresi
            print("Tarayıcı kapatılıyor.")
            browser.close()

if __name__ == "__main__":
    main_automation()