# Public deployment guide

## 1) On your Ubuntu VPS

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2) Clone the project

```bash
cd /var/www
sudo git clone https://github.com/your-user/voting-student-starter.git
cd voting-student-starter
```

## 3) Set production env

```bash
cp .env.production.example .env.production
nano .env.production
```

Example:

```env
SEPOLIA_RPC_URL=https://sepolia.drpc.org
PORT=3002
APP_ORIGIN=https://your-domain.com
```

## 4) Verify before starting

```bash
npm install
npm run verify
```

## 5) Start the app with PM2

```bash
pm2 start "npm run start:sepolia" --name voting-app --cwd /var/www/voting-student-starter
pm2 save
pm2 status
```

## 6) Nginx config

```bash
sudo nano /etc/nginx/sites-available/voting
```

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com www.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/voting /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 7) Get HTTPS certificate

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## 8) Test the public URL

```bash
curl -I https://your-domain.com
curl https://your-domain.com/sepolia
```

Your app should be available at:

```text
https://your-domain.com/sepolia
```
