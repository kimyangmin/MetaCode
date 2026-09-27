#!/bin/sh
# 운영 서버 백업. 저장소 루트에서 실행한다.
#   sh infra/backup.sh          DB(PostgreSQL) 압축 덤프. 14일 보관
#   sh infra/backup.sh files    첨부 파일(SeaweedFS 데이터) 압축본. 2개(약 2주) 보관
# 자동 실행 (crontab -e). 서버 시계가 UTC이므로 04:00 KST = 19:00 UTC로 적는다:
#   0 19 * * * cd /home/ubuntu/MetaCode && sh infra/backup.sh >> backups/backup.log 2>&1
#   30 19 * * 0 cd /home/ubuntu/MetaCode && sh infra/backup.sh files >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
mkdir -p backups
compose() { docker compose -f infra/docker-compose.prod.yml --env-file .env.production "$@"; }
stamp=$(date +%Y%m%d-%H%M%S)

if [ "${1:-db}" = "files" ]; then
  # 실행 중인 저장소의 데이터 폴더를 그대로 묶는다. 쓰기가 거의 없는 새벽에 돌린다.
  file="backups/files-$stamp.tar.gz"
  volume="$(compose ps -q seaweedfs | xargs docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
  docker run --rm -v "$volume:/data:ro" alpine:3 tar czf - -C /data . > "$file"
  ls -1t backups/files-*.tar.gz | tail -n +3 | xargs -r rm -f
  echo "files backup ok: $file ($(du -h "$file" | cut -f1))"
  exit 0
fi

file="backups/postgres-$stamp.sql.gz"
compose exec -T postgres pg_dump -U metacode --clean --if-exists metacode | gzip > "$file"

# 덤프가 비었으면(실패) 남기지 않는다.
if [ "$(gzip -dc "$file" | head -c 1 | wc -c)" -eq 0 ]; then
  rm -f "$file"
  echo "backup failed: empty dump" >&2
  exit 1
fi

find backups -name 'postgres-*.sql.gz' -mtime +14 -delete
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
