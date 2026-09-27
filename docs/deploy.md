# 운영 서버 배포 (Oracle Cloud · Ubuntu)

서버 한 대에 이 저장소를 클론하고 Docker Compose로 전체를 띄웁니다. 구성은 [infra/docker-compose.prod.yml](../infra/docker-compose.prod.yml)에 있습니다.

```
인터넷 ──80/443──▶ Caddy (HTTPS 자동 발급)
                    ├─ metacode.kimyangmin.me        → 웹 (정적 파일)
                    ├─ api.metacode.kimyangmin.me    → server:3000 (API + WebSocket)
                    └─ files.metacode.kimyangmin.me  → seaweedfs:9000 (파일 저장소)
                  내부 네트워크: server, migrate, postgres, redis, seaweedfs
```

- 외부에 열리는 포트는 Caddy의 80, 443(TCP/UDP)뿐입니다. DB, Redis, 파일 저장소는 서버 밖에서 접속할 수 없습니다.
- 도메인은 `.env.production`에서 바꿀 수 있습니다. 아래 예시는 기본값 기준입니다.
- 서버 사양: VM.Standard3.Flex (x86_64). 이미지를 서버에서 빌드하므로 메모리 2GB 이상을 권장합니다.

## 1. DNS 설정

도메인 관리 화면에서 A 레코드 세 개를 서버의 **공인 IP**로 만듭니다.

| 이름 | 종류 | 값 |
| --- | --- | --- |
| `metacode` | A | 서버 공인 IP |
| `api.metacode` | A | 서버 공인 IP |
| `files.metacode` | A | 서버 공인 IP |

반영됐는지 확인 (각각 서버 IP가 나와야 합니다):

```bash
nslookup api.metacode.kimyangmin.me
```

## 2. 포트 열기 (두 군데 모두)

Oracle Cloud는 **클라우드 방화벽**과 **서버 안의 방화벽**이 따로 있어서 둘 다 열어야 합니다. 하나만 열면 접속되지 않습니다.

### 2-1. 클라우드 방화벽 (OCI 콘솔)

Networking → Virtual Cloud Networks → 서버의 VCN → Subnet → Security List → **Add Ingress Rules**

| Source CIDR | IP Protocol | Destination Port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` |

### 2-2. 서버 방화벽 (iptables)

Oracle의 Ubuntu 이미지는 SSH(22) 외의 들어오는 연결을 기본으로 막습니다. 서버에 SSH로 접속해서 실행합니다.

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
```

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
```

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
```

```bash
sudo netfilter-persistent save
```

추가한 ACCEPT 줄이 `REJECT` 줄보다 위에 있는지 확인합니다:

```bash
sudo iptables -L INPUT --line-numbers
```

나중에 `netfilter-persistent reload`로 규칙을 다시 읽으면 Docker가 넣어 둔 규칙이 사라질 수 있습니다. 그때는 `sudo systemctl restart docker`로 되살립니다.

## 3. Docker 설치

Docker 공식 저장소에서 설치합니다.

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

`sudo` 없이 docker를 쓰도록 현재 사용자를 docker 그룹에 넣고, **SSH를 다시 접속**합니다.

```bash
sudo usermod -aG docker $USER
```

## 4. 운영용 GitHub OAuth App 만들기

개발용 앱과 **따로** 만듭니다 (OAuth App은 콜백 URL을 하나만 받습니다).
GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**

| 항목 | 값 |
| --- | --- |
| Application name | `MetaCode` |
| Homepage URL | `https://metacode.kimyangmin.me` |
| Authorization callback URL | `https://api.metacode.kimyangmin.me/auth/github/callback` |

Client ID와 새로 만든 Client secret은 다음 단계에서 `.env.production`에 넣습니다.

## 5. 클론하고 환경변수 작성

```bash
git clone https://github.com/kimyangmin/MetaCode.git && cd MetaCode
```

```bash
cp .env.production.example .env.production && chmod 600 .env.production
```

`.env.production`을 열어 채웁니다.

```bash
nano .env.production
```

- `ACME_EMAIL`: HTTPS 인증서 관련 알림을 받을 이메일
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: 4단계에서 만든 값
- `JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `S3_SECRET_KEY`: 각각 아래 명령으로 만든 **서로 다른** 값

```bash
openssl rand -hex 32
```

`POSTGRES_PASSWORD`는 DB를 처음 만들 때 정해집니다. 첫 실행 뒤에 바꾸면 DB에 접속할 수 없으니 바꾸지 마세요.

## 6. 실행

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

처음에는 이미지를 빌드하느라 몇 분 걸립니다. 순서는 자동입니다: DB 준비 → 마이그레이션(`migrate`) → 서버 → Caddy.

상태 확인 (`migrate`, `seaweedfs-init`은 `Exited (0)`이 정상입니다):

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production ps -a
```

서버 확인 (`{"status":"ok"}`가 나와야 합니다):

```bash
curl https://api.metacode.kimyangmin.me/health
```

브라우저에서 `https://metacode.kimyangmin.me`를 열고 GitHub로 로그인해 봅니다.

## 7. 업데이트

9단계를 설정해 두면 `main`에 push될 때(dev → main PR 병합 포함) CI가 통과한 뒤 자동으로 배포됩니다. 손으로 배포할 때는 서버에서 같은 스크립트를 실행합니다. `main`의 새 코드를 받아 다시 빌드하고, 새 마이그레이션은 `migrate`가 자동으로 적용합니다.

```bash
bash infra/deploy.sh
```

서버 저장소에 고친 파일이 있거나 `main` 기록이 갈라져 있으면 덮어쓰지 않고 멈춥니다. 배포한 코드에 문제가 있으면 되돌리는 커밋(revert)을 `main`에 올려 다시 배포합니다.

## 8. 백업

DB를 `backups/`에 압축 덤프로 저장하고 14일 지난 파일은 지웁니다.

```bash
sh infra/backup.sh
```

매일 자동으로 실행하려면 `crontab -e`에 추가합니다 (경로는 클론한 위치에 맞게). Oracle Cloud 서버의 시계는 기본으로 UTC이므로, 한국 시간 04:00은 `19:00 UTC`로 적습니다. 서버 시간대는 `timedatectl`로 확인합니다.

```
0 19 * * * cd /home/ubuntu/MetaCode && sh infra/backup.sh >> backups/backup.log 2>&1
```

백업은 같은 서버 디스크에 남으므로, 서버가 통째로 사라지는 경우까지 대비하려면 `backups/`를 Oracle Object Storage 같은 다른 곳에 주기적으로 복사하세요. 첨부 파일은 따로 백업합니다 (저장소 데이터 폴더 압축본, 최근 2개 보관):

```bash
sh infra/backup.sh files
```

매주 일요일 새벽에 자동으로 돌리려면 crontab에 추가합니다 (04:30 KST = 19:30 UTC):

```
30 19 * * 0 cd /home/ubuntu/MetaCode && sh infra/backup.sh files >> backups/backup.log 2>&1
```

복원 (백업 파일 이름을 바꿔서):

```bash
gzip -dc backups/postgres-YYYYMMDD-HHMMSS.sql.gz | docker compose -f infra/docker-compose.prod.yml --env-file .env.production exec -T postgres psql -U metacode -d metacode
```

## 9. 자동 배포 (GitHub Actions)

[ci.yml](../.github/workflows/ci.yml)의 `deploy` 작업이 `main` push에서 검사(`check`)가 통과하면 SSH로 서버에 접속합니다. 배포 전용 키는 서버에서 `infra/deploy.sh`만 실행할 수 있게 묶어 두므로, 키가 새더라도 셸을 얻을 수는 없습니다.

GitHub Actions 러너의 IP는 정해져 있지 않으므로 서버의 SSH(22) 포트가 인터넷에 열려 있어야 합니다 (Oracle 기본 설정).

### 9-1. 배포 전용 키 만들기 (서버에서)

```bash
ssh-keygen -t ed25519 -N '' -C github-actions-deploy -f ~/deploy_key
```

공개 키를 `authorized_keys`에 **이 스크립트만 실행하도록** 추가합니다 (경로는 클론한 위치에 맞게).

```bash
echo "command=\"bash $HOME/MetaCode/infra/deploy.sh\",restrict $(cat ~/deploy_key.pub)" >> ~/.ssh/authorized_keys
```

### 9-2. GitHub에 비밀값 등록

저장소 → Settings → Environments → **production** 환경을 만들고(없으면 첫 배포 때 자동으로 생김), 그 안의 Environment secrets에 넣습니다.

| 이름 | 값 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 서버에서 `cat ~/deploy_key`로 본 개인 키 전체 (`-----BEGIN`부터 `END-----`까지) |
| `DEPLOY_HOST` | 서버 공인 IP |
| `DEPLOY_KNOWN_HOSTS` | 서버에서 `ssh-keyscan -t ed25519 localhost \| sed "s/^localhost/<서버 공인 IP>/"`로 만든 한 줄 |

`DEPLOY_KNOWN_HOSTS`는 러너가 접속한 서버가 진짜 이 서버인지 확인하는 데 씁니다. 등록했으면 서버의 개인 키 파일은 지웁니다.

```bash
rm ~/deploy_key ~/deploy_key.pub
```

production 환경의 **Required reviewers**를 켜면 배포 전에 GitHub에서 승인을 한 번 거치게 할 수도 있습니다.

### 9-3. 확인

Actions 탭에서 `main`의 CI를 **Re-run all jobs**로 다시 돌리거나 `main`에 새 커밋을 올리면 `deploy` 작업의 로그에 `배포 완료: <커밋>`이 나옵니다. 키를 없애려면 `~/.ssh/authorized_keys`에서 `github-actions-deploy` 줄을 지웁니다.

## 문제 해결

로그 보기 (서비스 이름: `caddy`, `server`, `migrate`, `postgres`, `redis`, `seaweedfs`):

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production logs --tail 100 caddy
```

| 증상 | 확인할 것 |
| --- | --- |
| 사이트 접속이 안 됨 / 인증서 발급 실패 | DNS가 서버 IP를 가리키는지, 2단계 포트 두 군데가 모두 열렸는지. Caddy 로그의 `challenge failed` 메시지 |
| `migrate`가 `Exited (1)` | `logs migrate`. `POSTGRES_PASSWORD`를 첫 실행 뒤에 바꿨는지 |
| GitHub 로그인 후 오류 | 운영용 OAuth App의 콜백 URL이 `https://<API_DOMAIN>/auth/github/callback`과 정확히 같은지 |
| 로그인은 되는데 새로고침하면 풀림 | `.env.production`의 `APP_DOMAIN`, `API_DOMAIN`이 실제 주소와 같은지 (쿠키와 CORS가 이 값을 씀) |
