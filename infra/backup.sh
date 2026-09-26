#!/bin/sh
# 운영 DB(PostgreSQL)를 압축 덤프로 백업하고, 14일 지난 백업은 지운다.
# 저장소 루트에서 실행한다: sh infra/backup.sh
# 매일 04:00 KST 자동 실행 (crontab -e). 서버 시계가 UTC이므로 19:00 UTC로 적는다:
#   0 19 * * * cd /home/ubuntu/MetaCode && sh infra/backup.sh >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
mkdir -p backups

file="backups/postgres-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U metacode --clean --if-exists metacode | gzip > "$file"

# 덤프가 비었으면(실패) 남기지 않는다.
if [ "$(gzip -dc "$file" | head -c 1 | wc -c)" -eq 0 ]; then
  rm -f "$file"
  echo "backup failed: empty dump" >&2
  exit 1
fi

find backups -name 'postgres-*.sql.gz' -mtime +14 -delete
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
