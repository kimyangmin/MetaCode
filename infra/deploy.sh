#!/bin/bash
# 운영 서버 배포. origin/main의 최신 코드를 받아 이미지를 다시 빌드하고 띄운다.
#   bash infra/deploy.sh
# main에 push되면 GitHub Actions(.github/workflows/ci.yml의 deploy 작업)가 CI 통과 후 SSH로 실행한다.
# 배포 전용 SSH 키는 authorized_keys의 command=로 이 스크립트만 실행할 수 있게 묶는다 (docs/deploy.md 9단계).
set -euo pipefail

# git이 실행 중에 이 파일을 바꿀 수 있다. bash는 파일을 읽어 가며 실행하므로,
# 전체를 함수로 감싸 끝까지 읽어 둔 뒤에 실행한다.
main() {
  cd "$(dirname "$0")/.."
  compose() { docker compose -f infra/docker-compose.prod.yml --env-file .env.production "$@"; }

  # 동시에 두 번 배포하지 않는다.
  exec 9>/tmp/metacode-deploy.lock
  if ! flock -n 9; then
    echo "다른 배포가 진행 중입니다." >&2
    exit 1
  fi

  if [ "$(git rev-parse --abbrev-ref HEAD)" != main ]; then
    echo "서버 저장소가 main 브랜치가 아닙니다." >&2
    exit 1
  fi

  # 서버에서 고친 파일이 있거나 main 기록이 갈라졌으면 덮어쓰지 않고 멈춘다.
  git fetch --quiet origin main
  before=$(git rev-parse --short HEAD)
  git merge --ff-only --quiet origin/main
  after=$(git rev-parse --short HEAD)
  echo "배포: $before -> $after ($(git log -1 --format=%s))"

  # 새 마이그레이션은 migrate 서비스가 서버보다 먼저 적용한다.
  compose up -d --build --remove-orphans

  # 새 서버가 요청을 받을 때까지 기다린다 (최대 약 2분).
  for _ in $(seq 1 60); do
    if compose exec -T server node -e \
      "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
      2>/dev/null; then
      # 이전 빌드에서 남은 이미지를 지운다 (서버 이미지 하나가 800MB 정도).
      docker image prune -f >/dev/null
      echo "배포 완료: $after"
      return 0
    fi
    sleep 2
  done

  echo "서버가 응답하지 않습니다. 로그를 확인하세요:" >&2
  compose logs --tail 50 server >&2
  exit 1
}

main "$@"
exit
