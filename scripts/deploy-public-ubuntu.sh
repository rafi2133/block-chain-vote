#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   export DOMAIN="your-domain.com"
#   export REPO_URL="https://github.com/your-user/voting-student-starter.git"
#   export APP_PATH="/var/www/voting-student-starter"
#   sudo bash scripts/deploy-public-ubuntu.sh
#
# Or edit the values below before running.

DOMAIN="${DOMAIN:-your-domain.com}"
REPO_URL="${REPO_URL:-https://github.com/your-user/voting-student-starter.git}"
APP_PATH="${APP_PATH:-/var/www/voting-student-starter}"
NODE_MAJOR="24"

echo "==> Installing system dependencies"
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx

echo "==> Installing Node.js ${NODE_MAJOR}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v

echo "==> Installing PM2"
sudo npm install -g pm2

echo "==> Cloning app"
sudo mkdir -p /var/www
if [ ! -d "$APP_PATH/.git" ]; then
  sudo git clone "$REPO_URL" "$APP_PATH"
fi
sudo chown -R "$USER:$USER" "$APP_PATH"

cd "$APP_PATH"

cat > .env.production <<EOF
SEPOLIA_RPC_URL=https://sepolia.drpc.org
PORT=3002
APP_ORIGIN=https://${DOMAIN}
EOF

npm install
npm run verify

if pm2 list | grep -q "voting-app"; then
  pm2 delete voting-app || true
fi

pm2 start "npm run start:sepolia" --name voting-app --cwd "$APP_PATH"
pm2 save

cat > /etc/nginx/sites-available/voting <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/voting /etc/nginx/sites-enabled/voting
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos -m admin@${DOMAIN}

sudo nginx -t
sudo systemctl reload nginx

echo
echo "Deployment complete."
echo "Public URL: https://${DOMAIN}/sepolia"
echo "PM2 status: pm2 status"
echo "Logs: pm2 logs voting-app"
