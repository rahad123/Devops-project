#!/bin/bash
set -e

APP_DIR="/opt/bus-ticket-management/backend"
BACKUP_DIR="/opt/bus-ticket-management/backups"
RETENTION_DAYS=7

echo "=== Database Backup ==="

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql.gz"

# Create backup
echo "Creating backup..."
docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T postgres \
  pg_dump -U busticket busticket | gzip > "$BACKUP_FILE"

# Verify backup
if [ -s "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✅ Backup created: $BACKUP_FILE ($SIZE)"
else
  echo "❌ Backup failed - empty file"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Cleanup old backups
echo "Cleaning backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "db_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# List remaining backups
echo ""
echo "Current backups:"
ls -lh "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null || echo "  No backups found"

echo "=== Done ==="
