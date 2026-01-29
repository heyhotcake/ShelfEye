#!/bin/bash
# ShelfEye Database Backup Script
# Run daily via cron: 0 2 * * * /home/naniwa/ShelfEye/scripts/backup-database.sh

set -e

BACKUP_DIR="/home/naniwa/backups"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/shelfeye_$DATE.sql.gz"

# Load environment variables
if [ -f /home/naniwa/ShelfEye/.env.pi ]; then
  source /home/naniwa/ShelfEye/.env.pi
fi

# Check DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "[Backup] ERROR: DATABASE_URL not set"
  exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting database backup at $(date)"

# Perform backup with pg_dump
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

# Verify backup was created and has content
if [ ! -s "$BACKUP_FILE" ]; then
  echo "[Backup] ERROR: Backup file is empty or not created"
  exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[Backup] Created: $BACKUP_FILE ($BACKUP_SIZE)"

# Delete backups older than retention period
DELETED=$(find "$BACKUP_DIR" -name "shelfeye_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[Backup] Deleted $DELETED old backup(s) (older than $RETENTION_DAYS days)"
fi

# List current backups
echo "[Backup] Current backups:"
ls -lh "$BACKUP_DIR"/shelfeye_*.sql.gz 2>/dev/null | tail -5

echo "[Backup] Completed successfully at $(date)"
