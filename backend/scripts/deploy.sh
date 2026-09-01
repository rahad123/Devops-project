#!/bin/bash
set -e

APP_NAME="bus-ticket-backend"
APP_DIR="/opt/bus-ticket-management/backend"
BACKUP_DIR="/opt/bus-ticket-management/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== Deploy $APP_NAME ==="

cd "$APP_DIR"

# Backup database before deploy
echo "1. Backing up database..."
mkdir -p "$BACKUP_DIR"
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U busticket busticket | gzip > "$BACKUP_DIR/db_backup_$TIMESTAMP.sql.gz"
echo "   Backup saved: db_backup_$TIMESTAMP.sql.gz"

# Pull latest code
echo "2. Pulling latest code..."
git pull origin main

# Build new image
echo "3. Building Docker image..."
docker build -t $APP_NAME:latest .

# Restart services
echo "4. Restarting services..."
docker compose -f docker-compose.prod.yml up -d --force-recreate

# Wait for health check
echo "5. Waiting for app to start..."
sleep 10

# Verify
if curl -sf http://localhost:5000/health > /dev/null 2>&1; then
  echo "✅ Deploy successful! App running on http://localhost:5000"
else
  echo "❌ Deploy failed. Rolling back..."
  docker compose -f docker-compose.prod.yml logs app --tail=50
  exit 1
fi

# Cleanup old backups (keep last 7)
echo "6. Cleaning old backups..."
ls -t "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null

echo "=== Done ==="
