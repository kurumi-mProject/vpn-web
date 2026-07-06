#!/bin/bash
set -e

SERVER_IP="185.105.90.127"
TURN_USER="komochat"
TURN_PASS="komochat2026"
APP_DIR="/opt/messenger"

echo "=== [1/7] Обновление системы ==="
apt-get update -qq
apt-get install -y -qq curl unzip coturn nginx ufw golang-go

# Добавляем swap если нет (нужен для компиляции SQLite)
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  echo "Создаём swap 1GB..."
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

echo "=== [2/7] Скачивание исходников ==="
mkdir -p $APP_DIR
curl -sL https://lklunallm.icu/messenger_src.zip -o /tmp/messenger_src.zip
unzip -q -o /tmp/messenger_src.zip -d /tmp/messenger_extracted
cp -r /tmp/messenger_extracted/messenger/. $APP_DIR/
rm -rf /tmp/messenger_src.zip /tmp/messenger_extracted

echo "=== [3/7] Сборка мессенджера ==="
cd $APP_DIR
export HOME=/root
go mod tidy
go build -o messenger .
echo "Сборка OK"

echo "=== [4/7] Настройка coturn ==="
cat > /etc/turnserver.conf << EOF
listening-port=3478
alt-listening-port=443
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=$SERVER_IP
realm=messenger.local
server-name=messenger.local
user=$TURN_USER:$TURN_PASS
lt-cred-mech
fingerprint
no-multicast-peers
no-cli
log-file=/var/log/coturn.log
EOF
systemctl enable coturn
systemctl restart coturn

echo "=== [5/7] Настройка nginx ==="
cat > /etc/nginx/sites-available/messenger << EOF
server {
    listen 80 default_server;

    root $APP_DIR/frontend;
    index index.html;

    location / { try_files \$uri \$uri/ /index.html; }

    location /messenger/ {
        proxy_pass http://127.0.0.1:8001/messenger/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/messenger /etc/nginx/sites-enabled/messenger
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "=== [6/7] Systemd сервис ==="
cat > /etc/systemd/system/messenger.service << EOF
[Unit]
Description=Messenger
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/messenger
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable messenger
systemctl restart messenger

echo "=== [7/7] Открытие портов ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 5349/udp
ufw allow 5349/tcp
ufw --force enable

sleep 2
echo ""
echo "======================================"
echo "  Готово!"
echo "  Сайт:      http://$SERVER_IP"
echo "  WS:        ws://$SERVER_IP/messenger/ws"
echo "  TURN:      $SERVER_IP:3478"
echo "  TURN 443:  $SERVER_IP:443 (UDP)"
echo "  Логин:     $TURN_USER / $TURN_PASS"
echo "======================================"
systemctl status messenger --no-pager | tail -5
