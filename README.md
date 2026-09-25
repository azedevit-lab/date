# 🚗 Date Drive

Date dəvəti 3D oyun formasında. Fatimə öz maşınına minir və Bakının gecə 3D xəritəsində (Alov qüllələri, Şeytan çarxı, Qız qalası, Fəvvarələr, Nizami, Gözəllik sərgisi, Heydər Əliyev Mərkəzi...) sürür. Yol boyu dayanacaqlarda mini oyunlar var (sual, yaddaş kartları, onun şəklindən tapmaca, "Gözəllik sərgisi" — binada onun şəkli), ⭐ toplayır, məkanlara yaxınlaşanda sənin yüklədiyin mahnılar çalır. Son ünvanda sənin ikonun gözləyir — çatanda oyunun içində çat açılır, sən sual verirsən, o cavablayır. Sonda date kartı.

Hər şey **Admin → Mətnlər**-dən dəyişdirilir: sənin və onun şəkli, maşının rəngi, başlanğıc/son məkan, dayanacaqlar və tapşırıqlar, çat sualları, mahnılar, son kart.

Mahnılar `data/uploads/` qovluğunda saxlanır (Docker-də `./data` volume-u ilə birlikdə).

## Lokal işə salmaq

```bash
npm install
cp .env.example .env               # ADMIN_PASSWORD-u dəyiş
ADMIN_PASSWORD=supersecret123 npm run dev
```
- Sayt: http://localhost:5173
- Admin: http://localhost:5173/admin

## Serverdə deploy (təmiz Ubuntu 22.04 / 24.04)

1. Cloudflare DNS: `forfatima` üçün **A qeydi** serverin IP-sinə, əvvəlcə **DNS only (boz bulud)**.
2. Serverdə:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   sudo git clone https://github.com/azedevit-lab/date.git /opt/date
   cd /opt/date && sudo bash install.sh
   ```
3. Skriptin sonunda admin şifrəsi göstərilir (həm də `/opt/date/.env`-də saxlanır).
4. `https://forfatima.devlab.az` açılandan sonra Cloudflare-də buludu **Proxied (narıncı)** et, **SSL/TLS → Full (strict)** seç. *Flexible* seçmə — sonsuz yönləndirmə olur.

Cloudflare istifadə etmirsənsə: `sudo CLOUDFLARE=0 bash install.sh`.

`install.sh` nə edir: Node 24, Caddy (avtomatik HTTPS), `datesite` systemd servisi, `.env` (təsadüfi şifrə və sessiya açarı), build. Tətbiq yalnız `127.0.0.1:3001`-də dinləyir, xaricə Caddy açılır.

**Yeniləmə:** `cd /opt/date && sudo bash install.sh` — kodu çəkir, build edir, restart edir. `data/` (baza, şəkillər, mahnılar) və `.env` toxunulmaz qalır.

Başqa domen: `sudo DOMAIN=basqa.domen.az bash install.sh`

Faydalı əmrlər: `journalctl -u datesite -f` (loglar), `systemctl restart datesite`.

**Ehtiyat nüsxə:** yalnız `/opt/date/data/` qovluğu (baza + yüklənmiş fayllar).

## Xəritəni yeniləmək

`node scripts/build-baku.mjs --fetch` — OpenStreetMap-dən təzə məlumat çəkib `client/public/baku.json` yaradır.

## Müəlliflik

- Xəritə məlumatı: © OpenStreetMap contributors (ODbL)
- Maşın modeli: "Ferrari 458 Italia" — vicent091036, CC BY 4.0 (three.js nümunələrindən)

## İstifadə
1. `/admin`-ə gir → qızın adını, öz adını, istəsən şəxsi mesaj yaz → **Link yarat**.
2. Linki kopyala və göndər.
3. Admin paneldə canlı görürsən: linki açıbmı, neçə dəfə "Yox"-a basmağa çalışıb, nə seçib, hansı tarixi seçib.

**Önizlə** düyməsi ilə özün test edə bilərsən, amma orada seçim göndərsən cavab kimi yazılacaq — sonra **Sıfırla** bas.

## Pentester üçün gizli yerlər 😏
- DevTools console-da mesaj + flag
- HTML source-da comment
- `/robots.txt`, `/.well-known/security.txt`
- `GET /api/no` → `418 I'm a teapot`
- Response header-də `X-Hint`

## Təhlükəsizlik
O, pentesterdir — yəqin ki, saytı yoxlayacaq. Buna görə:
- Bütün SQL sorğuları prepared statement-lərlədir
- Admin session HMAC ilə imzalanmış `HttpOnly; SameSite=Strict` cookie-dədir
- Login-ə rate limit var (15 dəqiqədə 10 cəhd)
- Token 96 bitdir, təxmin etmək mümkün deyil
- CSP, X-Frame-Options, nosniff header-ləri qoyulub
