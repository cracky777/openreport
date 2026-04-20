#!/bin/bash
# Open Report — Server Setup Script
# Run this on a fresh Ubuntu 22.04+ server (Hetzner CPX11)

set -e

echo "=== Open Report Server Setup ==="

# 1. Update system
echo "[1/6] Updating system..."
apt update && apt upgrade -y

# 2. Install Docker
echo "[2/6] Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 3. Install Docker Compose
echo "[3/6] Installing Docker Compose..."
apt install -y docker-compose-plugin

# 4. Create app directory
echo "[4/6] Setting up application..."
mkdir -p /opt/openreport
cd /opt/openreport

# Clone the repo
git clone https://github.com/cracky777/openreport.git .

# 5. Configure environment
echo "[5/6] Configuring environment..."
SESSION_SECRET=$(openssl rand -hex 32)

cat > .env << EOF
NODE_ENV=production
PORT=3001
SESSION_SECRET=${SESSION_SECRET}
EOF

echo "Generated session secret."

# 6. Build and start
echo "[6/6] Building and starting Open Report..."
docker compose up -d --build

echo ""
echo "=== Setup Complete ==="
echo "Open Report is running at http://$(curl -s ifconfig.me)"
echo ""
echo "Default credentials:"
echo "  Email: admin@openreport.local"
echo "  Password: admin"
echo ""
echo "IMPORTANT: Change the admin password after first login!"
echo ""
echo "Next steps:"
echo "  1. Point your domain to this server's IP: $(curl -s ifconfig.me)"
echo "  2. Edit deploy/nginx.conf — replace 'yourdomain.com' with your domain"
echo "  3. Run: docker compose run certbot certonly --webroot -w /var/lib/letsencrypt -d yourdomain.com"
echo "  4. Uncomment HTTPS block in deploy/nginx.conf"
echo "  5. Run: docker compose restart nginx"
