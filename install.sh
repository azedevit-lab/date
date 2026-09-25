#!/usr/bin/env bash
# Təmiz Ubuntu (22.04 / 24.04) serverində quraşdırma və yeniləmə.
#
#   sudo git clone https://github.com/azedevit-lab/date.git /opt/date && cd /opt/date
#   sudo bash install.sh                      # domen: forfatima.devlab.az
#   sudo DOMAIN=basqa.domen.az bash install.sh
#
# Yenidən işə salsan: kodu yeniləyir, yenidən build edir və servisi restart edir.
# Baza, yüklənmiş şəkillər və mahnılar (data/) və .env toxunulmaz qalır.
set -euo pipefail

DOMAIN="${DOMAIN:-forfatima.devlab.az}"
APP_USER="datesite"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=3001

if [[ $EUID -ne 0 ]]; then
  echo "sudo ilə işə sal: sudo bash install.sh" >&2
  exit 1
fi

if [[ "$APP_DIR" == /root/* ]]; then
  echo "Layihəni /root-a yox, /opt-a klonla (servis istifadəçisi /root-a çata bilmir):" >&2
  echo "  sudo git clone https://github.com/azedevit-lab/date.git /opt/date && cd /opt/date && sudo bash install.sh" >&2
  exit 1
fi

log() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

log "Sistem paketləri"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git debian-keyring debian-archive-keyring apt-transport-https openssl

# Node 22.13+ lazımdır (daxili SQLite üçün) — Node 24 quraşdırırıq
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  log "Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node -v)"

# Caddy — avtomatik HTTPS (Let's Encrypt)
if ! command -v caddy >/dev/null; then
  log "Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

log "Tətbiq istifadəçisi və qovluqlar"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/data/uploads"

# .env — yalnız ilk dəfə yaradılır
NEW_PASSWORD=""
if [[ ! -f "$APP_DIR/.env" ]]; then
  log ".env yaradılır"
  NEW_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  cat >"$APP_DIR/.env" <<EOF
ADMIN_PASSWORD=$NEW_PASSWORD
SESSION_SECRET=$(openssl rand -hex 32)
PORT=$PORT
HOST=127.0.0.1
TRUST_PROXY=1
NODE_ENV=production
DB_PATH=$APP_DIR/data/app.db
EOF
  chmod 600 "$APP_DIR/.env"
fi

log "Kodu yeniləmək (git varsa)"
if [[ -d "$APP_DIR/.git" ]]; then
  git config --global --add safe.directory "$APP_DIR" || true
  git -C "$APP_DIR" pull --ff-only || echo "git pull alınmadı — mövcud kodla davam edirik"
fi

log "Asılılıqlar və build"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log "systemd servisi"
cat >/etc/systemd/system/datesite.service <<EOF
[Unit]
Description=Date site
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable datesite >/dev/null
systemctl restart datesite

log "Caddy ($DOMAIN)"
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode zstd gzip
  reverse_proxy 127.0.0.1:$PORT
  request_body {
    max_size 30MB
  }
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

# firewall aktivdirsə 80/443 açıq olsun
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/admin/me" >/dev/null; then
  STATUS="işləyir ✅"
else
  STATUS="cavab vermir ❌  (journalctl -u datesite -n 50)"
fi

echo
echo "────────────────────────────────────────────"
echo " Servis:  $STATUS"
echo " Sayt:    https://$DOMAIN"
echo " Admin:   https://$DOMAIN/admin"
if [[ -n "$NEW_PASSWORD" ]]; then
  echo " Şifrə:   $NEW_PASSWORD   (yadda saxla; $APP_DIR/.env faylındadır)"
else
  echo " Şifrə:   dəyişmədi ($APP_DIR/.env)"
fi
echo
echo " DNS: $DOMAIN üçün A qeydi bu serverin IP-sinə yönəlməlidir,"
echo "      yoxsa HTTPS sertifikatı alınmayacaq."
echo "────────────────────────────────────────────"
