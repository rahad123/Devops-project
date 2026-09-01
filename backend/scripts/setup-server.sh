#!/bin/bash
set -e

echo "=== Server Setup for Bus Ticket Management ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo ./setup-server.sh"
  exit 1
fi

# Install Docker
echo "1. Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "   Docker installed"
else
  echo "   Docker already installed"
fi

# Install Docker Compose plugin
echo "2. Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
  apt-get update
  apt-get install -y docker-compose-plugin
  echo "   Docker Compose installed"
else
  echo "   Docker Compose already installed"
fi

# Create app directory
echo "3. Setting up app directory..."
mkdir -p /opt/bus-ticket-management
mkdir -p /opt/bus-ticket-management/backups

# Clone repo (if not already cloned)
if [ ! -d "/opt/bus-ticket-management/.git" ]; then
  echo "   Cloning repository..."
  read -p "   Enter repo URL: " REPO_URL
  git clone "$REPO_URL" /opt/bus-ticket-management
else
  echo "   Repository already cloned"
fi

# Setup environment
echo "4. Setting up environment..."
if [ ! -f "/opt/bus-ticket-management/backend/.env" ]; then
  cp /opt/bus-ticket-management/backend/.env.example /opt/bus-ticket-management/backend/.env 2>/dev/null || true
  echo "   Created .env file - please edit it with real values:"
  echo "   nano /opt/bus-ticket-management/backend/.env"
fi

# Setup cron for daily backups
echo "5. Setting up backup cron..."
CRON_JOB="0 2 * * * /opt/bus-ticket-management/backend/scripts/backup-db.sh >> /var/log/bus-ticket-backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "backup-db.sh"; echo "$CRON_JOB") | crontab -
echo "   Daily backup scheduled at 2:00 AM"

# Setup firewall
echo "6. Configuring firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp
  ufw allow 5000/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "   Firewall rules added"
else
  echo "   ufw not installed - configure firewall manually"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit environment: nano /opt/bus-ticket-management/backend/.env"
echo "  2. Deploy: cd /opt/bus-ticket-management/backend && ./scripts/deploy.sh"
echo ""
echo "Useful commands:"
echo "  docker compose -f docker-compose.prod.yml logs -f app  # View logs"
echo "  docker compose -f docker-compose.prod.yml restart app # Restart app"
echo "  ./scripts/backup-db.sh                                 # Manual backup"
