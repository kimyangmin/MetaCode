# CLAUDE.md

Claude Code가 이 저장소에서 작업할 때 따르는 가이드입니다. 기능 목록, 로드맵, 브랜치/커밋 규칙은 [README.md](README.md)에 있고, 이 문서는 그 위에서 **설계 원칙과 작업 방식**을 정리합니다.

## 프로젝트 요약

MetaCode는 Discord/Slack 같은 채팅·음성 통화 플랫폼에 **메타버스 모드**를 더한 서비스입니다. 웹과 데스크톱 앱(Electron)으로 제공합니다.

- 커뮤니티마다 분수 광장, DM마다 모닥불 캠프가 하나씩 있고, 그 커뮤니티(또는 DM)의 온라인 멤버 전원이 캐릭터로 나타납니다.
- 커뮤니티 안의 텍스트 채널은 대화 기록을 주제별로 나누는 용도이고, 광장에는 모든 텍스트 채널의 메시지가 말풍선으로 뜹니다.
- 지금 보는 채널의 채팅 모드와 그 광장을 VSCode 화면 분할처럼 나란히 띄울 수 있습니다.
- 통화는 Discord식 음성 채널과 DM 통화입니다. 근접 음성을 켜면 같은 통화 참여자 중 광장에서 가까운 사람끼리만 들립니다.
- 추후 계절이나 행사에 맞춰 테마를 바꿀 수 있게 합니다.
- 로그인은 GitHub OAuth만 지원합니다.

## 현재 상태

- **Phase 1~2 완료, Phase 3 (파일·이미지 첨부) 구현 완료.** 다음은 Phase 4 (메타버스 모드 MVP)입니다.
- **운영 중:** https://metacode.kimyangmin.me (2026-09-26 첫 배포, `main` 기준). 서버는 SSH 별칭 `myserver3`(ubuntu, `~/MetaCode`)로 접속할 수 있고, 업데이트는 `git pull` 후 `docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build`입니다. DB 백업은 서버 crontab이 매일 04:00 KST(19:00 UTC)에 `infra/backup.sh`를 실행합니다 (`~/MetaCode/backups/`, 14일 보관, 로그 `backups/backup.log`). 운영 서버에서 무언가를 바꾸기 전에는 사용자에게 확인받습니다.
- 개발용 GitHub OAuth App(`localhost` 콜백)으로 웹·데스크톱, 운영용 OAuth App으로 운영 웹의 실제 로그인을 확인했습니다 (2026-09-26).
- 기술 스택은 README 표대로 확정되었습니다 (2026-09-26).
- Phase를 진행하면 이 섹션과 README 로드맵 체크박스를 함께 갱신합니다.

## 기술 메모

스캐폴딩하면서 정한 것들입니다. 바꿀 때는 이유를 확인하고 바꿉니다.

- **전 패키지 ESM:** NestJS 12가 ESM 전용이라 `apps/server`도 `"type": "module"`입니다. `web`, `server`, `shared`에서 상대 경로 import는 `.js` 확장자를 붙입니다 (`./app.module.js`). 예외는 `apps/desktop`으로, Electron의 sandbox preload가 CommonJS만 되므로 CommonJS로 빌드합니다.
- **shared는 빌드해서 쓴다:** `packages/shared`는 `tsc`로 `dist`에 ESM + 타입 선언을 내보내고, 다른 패키지는 `dist`를 import합니다. turbo의 `dependsOn: ["^build"]`가 먼저 빌드해 주고, `pnpm dev`에서는 `tsc --watch`가 돕니다. tsup은 TypeScript 6과 맞지 않아 쓰지 않습니다.
- **TypeScript는 6.0으로 고정:** TypeScript 7(Go 네이티브 버전)은 typescript-eslint와 Nest CLI가 아직 지원하지 않습니다. 이 도구들이 지원하기 전에는 올리지 않습니다.
- **desktop은 shared의 타입만 쓴다:** sandbox preload는 `electron` 일부 모듈 외에는 require할 수 없으므로, `@metacode/shared`는 `import type`으로만 가져옵니다.
- **서버 테스트:** 지금은 컨트롤러를 직접 생성해서 테스트합니다. Nest DI(`Test.createTestingModule`)를 Vitest에서 쓰게 되면 데코레이터 메타데이터를 위해 `unplugin-swc`를 추가해야 합니다.
- **pnpm 설치 스크립트:** pnpm 10은 의존성 설치 스크립트를 막으므로, 필요한 패키지는 `pnpm-workspace.yaml`의 `onlyBuiltDependencies`에 추가합니다 (Prisma 도입 시 `prisma`, `@prisma/engines` 등).
- **로컬 S3는 SeaweedFS:** MinIO가 Docker 이미지 배포를 중단해서(`minio/minio`, `quay.io/minio/minio` 모두 pull 불가) SeaweedFS를 씁니다. S3 API는 `localhost:9000`, 계정은 `infra/seaweedfs/s3.json`에 있고, 버킷은 `seaweedfs-init` 컨테이너가 만듭니다. S3 클라이언트는 `forcePathStyle: true`로 씁니다.
- **presigned URL 체크섬:** AWS SDK v3는 기본으로 presigned URL에 CRC32 체크섬을 넣는데, 서명할 때는 본문이 비어 있어서 실제 업로드가 `BadDigest`(400)로 실패합니다. S3 클라이언트를 만들 때 `requestChecksumCalculation: 'WHEN_REQUIRED'`를 꼭 넣습니다. SeaweedFS뿐 아니라 실제 S3에서도 같은 문제입니다.
- **로컬 포트:** Docker 컨테이너 포트는 `127.0.0.1`에만 엽니다 (Linux에서 Docker가 연 포트는 ufw를 우회함). 개발 PC에 설치된 PostgreSQL과 겹치지 않게 Docker PostgreSQL은 호스트 포트 **5433**을 씁니다.
- **운영 구성:** `infra/docker-compose.prod.yml` + `.env.production` (예시: `.env.production.example`). 배포 절차는 `docs/deploy.md`.
  - 도메인: 웹 `APP_DOMAIN`(metacode.kimyangmin.me), API `API_DOMAIN`(api.metacode…), 파일 `FILES_DOMAIN`(files.metacode…). API를 별도 서브도메인에 둔 이유는 경로 접두사(/api) 없이 쿠키 경로(`/auth`)와 OAuth 콜백 URL을 개발 환경과 똑같이 쓰기 위해서입니다. 웹과 API는 같은 사이트(kimyangmin.me)라 SameSite=Lax 쿠키가 그대로 동작합니다.
  - 외부에는 Caddy의 80/443만 엽니다. 나머지는 내부 네트워크에만 둡니다. 이미지 태그는 버전을 고정하고 `restart: unless-stopped`를 겁니다.
  - 비밀값은 전부 `.env.production`으로 받습니다. SeaweedFS 계정도 시작할 때 환경변수로 설정 파일을 만듭니다 (개발용 `infra/seaweedfs/s3.json`은 운영에 쓰지 않음). 필수 값이 비면 compose가 시작하지 않습니다 (`${VAR:?}`).
  - 서버 이미지(`apps/server/Dockerfile`)는 `pnpm deploy --legacy --prod`로 운영 의존성만 담습니다. 마이그레이션은 같은 Dockerfile의 `migrate` 단계가 서버보다 먼저 실행합니다.
  - 웹은 `infra/caddy/Dockerfile`에서 `WEB_BASE=/`, `VITE_API_URL=https://<API_DOMAIN>`으로 빌드해 Caddy 이미지에 넣습니다 (Electron용 기본 빌드는 `base: './'`).
  - 서버 이미지가 740MB 정도로 큽니다. `@prisma/client`의 peer 의존성 때문에 Prisma CLI, Studio, TypeScript가 함께 들어갑니다. 필요하면 나중에 줄입니다.
  - 파일 저장소: 서버는 내부 주소(`S3_ENDPOINT=http://seaweedfs:9000`)로 읽고 쓰고, 브라우저에 줄 presigned URL은 공개 주소(`S3_PUBLIC_ENDPOINT=https://<FILES_DOMAIN>`)로 서명합니다 (서명에 호스트가 들어감). SeaweedFS는 기본으로 모든 출처의 CORS를 허용하므로(서명이 있어야 요청이 통함) Caddy에 CORS 설정은 필요 없습니다.
  - 백업: `sh infra/backup.sh`(DB, 매일) + `sh infra/backup.sh files`(첨부 파일, 매주 권장).
- **Oracle Cloud 주의점:**
  - 서버는 VM.Standard3.Flex(Intel, x86_64)라 amd64 이미지를 씁니다.
  - 포트를 열려면 VCN의 Security List(또는 NSG)와 서버 안의 iptables(`/etc/iptables/rules.v4`, Oracle Ubuntu 이미지는 기본으로 막혀 있음)를 **둘 다** 열어야 합니다.
  - LiveKit(Phase 5)은 UDP 포트 범위도 열어야 합니다.
- **Prisma 7:**
  - 접속 URL은 `schema.prisma`가 아니라 `apps/server/prisma.config.ts`에 있고, 루트 `.env`를 직접 읽습니다.
  - 클라이언트는 `apps/server/src/generated/prisma`에 생성되며 git에 올리지 않습니다. 서버의 `dev`/`build`/`typecheck`/`test` 스크립트가 먼저 `prisma generate`를 실행합니다.
  - DB 접속은 드라이버 어댑터(`@prisma/adapter-pg`)로 합니다.
  - npm의 `prisma@latest`가 8.0 RC를 가리키므로 `prisma`와 `@prisma/client`는 버전을 맞춰 고정합니다 (지금 7.10.0).
- **socket.io 버전:** `socket.io`는 `@nestjs/platform-socket.io`가 고정한 버전과 같아야 합니다. 다르면 두 벌이 설치되어 타입 오류가 납니다.
- **서버 테스트:**
  - `apps/server/test/*.e2e.test.ts`는 실제 앱을 임의 포트로 띄우고, GitHub는 `test/fake-github.ts`로 대신합니다.
  - DB는 `metacode_test`, Redis는 1번 DB를 씁니다 (`test/env.ts`, 전역 설정이 DB 생성·마이그레이션·초기화).
  - Vitest는 Nest 데코레이터 메타데이터 때문에 `unplugin-swc`로 변환합니다.
  - CI는 같은 포트(5433, 6379)의 서비스 컨테이너로 돌립니다.
- **Presence 한계:** 서버가 시작할 때 Redis의 Presence 키를 모두 지웁니다 (비정상 종료로 남은 연결 정리). 서버가 한 대라는 전제이므로, 여러 대로 늘리면 인스턴스별 키 + 만료 시간으로 바꿔야 합니다.
- **sandbox preload:** preload는 `electron` 외에는 require할 수 없어서 로컬 파일도 import하지 못합니다. IPC 채널 이름은 `apps/desktop/src/main/index.ts`와 `preload/index.ts`에 똑같이 적어 둡니다.
- **데스크톱 로그인은 루프백, 커스텀 스킴 아님:** 처음에는 `metacode://` 딥링크로 앱에 돌아오게 했지만, 브라우저마다 다른 앱 열기를 막거나(사용자 기본 브라우저 Comet에서 실제로 동작 안 함) 확인 창을 띄워서 루프백(RFC 8252)으로 바꿨습니다. 커스텀 스킴이 다시 필요해지면(예: 초대 링크로 앱 열기) 로그인과 별개로 도입합니다.
- **채팅 구조 (Phase 2):**
  - 서버: `apps/server/src/chat/`. 권한 판단은 `AccessService` 한 곳에서 합니다 (권한 없으면 존재 여부도 숨기려고 404).
  - 실시간: `ChatGateway`가 접속 때 인증하고, 볼 수 있는 커뮤니티/채널 방에 넣습니다. 메시지는 방 단위로만 보내므로 권한 없는 채널의 메시지는 받지 않습니다. 멤버십이 바뀌면(참여, 탈퇴, 채널 생성, DM 생성) HTTP 쪽 서비스가 `RealtimeService`로 방 구성을 바로 고칩니다.
  - 메시지 보내기는 WebSocket(`message:send` + ack), 기록 조회와 읽음 처리는 HTTP입니다.
  - PostgreSQL에는 uuid용 `max()`가 없어서 채널별 최신 메시지는 `DISTINCT ON`으로 구합니다 (`ChannelSummaryService`).
  - 웹: `RealtimeProvider`가 소켓 하나를 유지하고 서버 이벤트로 TanStack Query 캐시를 고칩니다. 온라인 상태와 입력 중 표시는 zustand 스토어에 둡니다. 재연결하면 전체 쿼리를 다시 불러옵니다.
  - 메시지 목록은 `column-reverse`로 그려 맨 아래가 기준점입니다. 이전 기록은 위쪽 끝 요소를 IntersectionObserver로 감지해 불러옵니다 (페이지가 그려지지 않는 숨은 탭에서는 동작하지 않음).
  - 입력창은 한글 조합 중 Enter(`isComposing`, keyCode 229)로 보내지 않습니다.
  - 라우터: 웹은 일반 주소, 데스크톱은 해시 주소(`#/c/...`). 로그인 전에 연 초대 링크는 sessionStorage에 기억했다가 로그인 후 이어 갑니다.
  - 아직 없는 것: 메시지 수정/삭제, 보내기 속도 제한, 모바일 화면(가로 1000px 미만이면 멤버 목록만 숨김).
- **여러 사용자로 확인:** `tools/fake-github.mjs`(가짜 GitHub, 앨리스/밥/캐롤) + 서버를 `GITHUB_OAUTH_URL`/`GITHUB_API_URL`=`http://localhost:4010`으로 띄웁니다. 두 번째 사용자는 다른 브라우저나 스크립트(socket.io-client)로 접속합니다.
- **첨부 파일 (Phase 3):** `apps/server/src/attachments/`, `apps/web/src/features/chat/uploads.ts`
  - 흐름: `POST /uploads`(권한·크기 확인, 크기를 서명에 넣은 presigned PUT) → 브라우저가 저장소에 직접 PUT → `POST /uploads/:id/complete`(크기 재확인, 이미지면 썸네일) → `message:send`의 `attachmentIds`로 메시지에 붙임(트랜잭션, 실패하면 메시지도 안 남음).
  - 이미지 판별은 파일 앞부분(매직 바이트)으로만 합니다: JPEG, PNG, GIF, WebP, AVIF. 확장자·브라우저가 준 형식은 믿지 않고, SVG(스크립트 가능)는 일반 파일입니다. 썸네일은 sharp로 긴 변 480px WebP를 만듭니다(압축 폭탄 방지: 1억 화소 제한).
  - 이미지가 아닌 파일은 항상 `application/octet-stream` + `Content-Disposition: attachment`로 내려보냅니다 (HTML/SVG가 브라우저에서 실행되지 않게).
  - 보기/받기는 `GET /attachments/:id` → 권한 확인 → 10분짜리 presigned URL로 302. 이 302는 `Cache-Control: no-store`여야 합니다. 브라우저 캐시는 사용자(쿠키)를 구분하지 않아서, 캐시하면 로그아웃 뒤에도 같은 브라우저에서 열렸습니다 (실제로 발견해 고침, 테스트 있음).
  - 데스크톱은 쿠키가 없어 `<img>`에 토큰을 붙일 수 없으므로, 메인 프로세스가 `session.webRequest.onBeforeSendHeaders`로 `/attachments/*` 요청에만 `Authorization`을 붙입니다. 다운로드는 브리지 `window.metacode.download(url)`(첨부 주소만 허용).
  - 보내지 않은 첨부(24시간 경과)는 서버가 한 시간마다 지우고, 커뮤니티를 지우면 저장소 파일도 지웁니다.
  - 메타버스 모드에서 첨부 메시지를 말풍선 대신 캐릭터 모션으로 보일지는 `messagePresentation()`(packages/shared)으로 판단합니다.
  - sharp는 운영 이미지(Alpine, linux x64)에서도 동작을 확인했습니다. 서버 이미지는 약 800MB입니다.
- **Windows에서 파일 수정:** Windows PowerShell 5.1의 `Get-Content`/`Set-Content`는 UTF-8 한글을 깨뜨립니다. 파일 수정은 편집 도구나 bash를 씁니다.

## 확정된 결정

2026-09-26 사용자와 정한 내용입니다.

| 항목 | 결정 |
| --- | --- |
| 배포 형태 | 웹 + 데스크톱 앱 둘 다 |
| 운영 서버 | Oracle Cloud의 Ubuntu 서버 한 대(VM.Standard3.Flex), 도메인 kimyangmin.me의 `metacode.` 아래 서브도메인 사용. 이 저장소를 서버에 클론해서 Docker Compose로 운영. 운영용 구성은 개발용과 따로 둠 |
| 파일 저장소 | AWS S3를 쓰지 않음. 운영에서도 SeaweedFS를 셀프 호스팅하고, 코드는 S3 API로 접근 |
| 광장 단위 | 커뮤니티마다 **분수 광장**(분수가 흐르는 넓은 광장) 하나, DM과 그룹 DM마다 **모닥불 캠프**(모닥불이 타오르는 좁은 야외 공간) 하나. 텍스트 채널마다 광장을 두지 않음 |
| 광장에 보이는 사람 | 그 커뮤니티(또는 DM) 멤버 중 온라인인 사람 전부 |
| 말풍선 범위 | 분수 광장에는 커뮤니티의 모든 텍스트 채널 메시지를 채널 이름과 함께 띄움 |
| 분할 화면 | 지금 보는 채널의 채팅 모드 + 그 채널이 속한 광장. 여러 채널 분할은 추후 별도 기능 |
| 통화 구조 | Discord식 음성 채널을 따로 둠. DM에서도 통화 가능 |
| 근접 음성 | 통화(음성 채널, DM 통화)마다 ON/OFF. 그 통화 참여자 누구나 변경 가능. ON이면 가까운 캐릭터끼리만 들리고, OFF면 거리와 상관없이 모두 들림 |
| 첨부 표시 | 메타버스 모드에서 말풍선 대신 캐릭터 모션. 모션은 캐릭터 에셋 작업(Phase 6) 때 추가하고, 그 전까지는 임시 표시 |
| 파일 크기 제한 | 기본 50MB |
| 도트 에셋 크기 | 타일 16×16px, 캐릭터 한 프레임 16×32px |
| 테마 | 계절·행사에 따라 테마를 바꿀 수 있어야 함. 기능은 추후에 만들지만, 맵·에셋 구조는 처음부터 테마 교체를 전제로 만듦 |

## 용어

문서, UI 문구, 코드에서 아래 용어를 일관되게 씁니다. 코드 식별자는 오른쪽 영문을 씁니다.
"채팅방"이라는 말은 뜻이 모호하므로 쓰지 않고, 텍스트 채널 / 음성 채널 / DM으로 구분합니다.

| 용어 | 코드 이름 | 의미 |
| --- | --- | --- |
| 커뮤니티 | `Community` | Discord의 "서버". 멤버, 채널들, 분수 광장 하나를 가짐 |
| 채널 | `Channel` | 대화 또는 통화 단위. 종류: 텍스트 채널(`TEXT`), 음성 채널(`VOICE`), DM(`DM`), 그룹 DM(`GROUP_DM`) |
| 광장 | `Plaza` | 커뮤니티 또는 DM에 1:1로 딸린 메타버스 공간 |
| 광장 맵 | `PlazaMap` | 광장의 맵 종류. `fountain-square`(분수 광장), `campfire`(모닥불 캠프) |
| 테마 | `Theme` | 계절·행사에 따라 바뀌는 겉모습 묶음 (타일셋, 장식 등). 기본값은 `default`. UI의 라이트/다크 모드(`ColorScheme`)와는 다른 개념 |
| 캐릭터 | `Character` | 유저당 하나. 모든 광장에서 같은 캐릭터 사용 |
| 메시지 / 첨부 | `Message` / `Attachment` | 채팅 모드와 메타버스 모드가 공유하는 단일 데이터 |
| 말풍선 | `SpeechBubble` | 메타버스 모드에서 메시지를 캐릭터 위에 띄우는 표현 |
| 첨부 모션 | `AttachmentEmote` | 첨부 메시지를 말풍선 대신 캐릭터 모션으로 보여주는 표현 |
| 통화 | `Call` | 음성 채널 또는 DM에서 진행 중인 음성 연결 |
| 근접 음성 | `ProximityVoice` | 광장 거리에 따라 통화 음성을 듣게 하는 설정 |
| 온라인 상태 | `Presence` | WebSocket 연결 기준의 접속 상태 |

## 설계 원칙

1. **메시지는 한 곳에만 있다.** 채팅 모드와 메타버스 모드는 같은 `message:created` 스트림을 구독하는 두 개의 뷰입니다. 메타버스 전용 메시지 저장소나 전용 전송 이벤트를 만들지 않습니다. 말풍선은 수신한 메시지를 작성자 캐릭터 위에 렌더링한 결과일 뿐입니다.
2. **표현 규칙은 공용 코드에 둔다.** 다음 같은 판정은 `packages/shared`에 두고 클라이언트와 서버가 같은 함수를 씁니다.
   - 이 메시지를 말풍선으로 보일지, 첨부 모션으로 보일지
   - 이 채널이 어느 광장에 속하는지 (`getPlazaId`)
   - 그 광장이 어떤 맵인지
3. **광장은 커뮤니티 또는 DM에 붙는다.**
   - 광장 ID는 `community:<communityId>` 또는 `dm:<channelId>`입니다. 커뮤니티의 텍스트/음성 채널은 모두 커뮤니티 광장에 속합니다.
   - 광장 인원(roster) = 커뮤니티(또는 DM) 멤버 ∩ 온라인 유저. Presence에서 계산하고, 광장을 열어두었는지와 상관없습니다.
   - 위치 업데이트(`plaza:moved`)는 그 광장을 지금 화면에 띄운 클라이언트에만 보냅니다.
   - 여러 커뮤니티에 속한 멤버는 여러 광장에 동시에 나타나고, 위치는 광장마다 따로 유지합니다. 처음 나타날 때는 맵의 스폰 지점에 둡니다.
4. **말풍선은 읽기 권한을 따른다.** 분수 광장은 커뮤니티의 모든 텍스트 채널 메시지를 말풍선으로 띄우지만, 보는 사람이 읽을 수 없는 채널의 메시지는 말풍선으로도 보내지 않습니다. 필터링은 서버가 채널 권한 기준으로 합니다.
5. **광장 위치는 휘발성이다.** 캐릭터 좌표는 Redis/메모리에만 두고 DB에 저장하지 않습니다. 영구 저장 대상은 메시지, 첨부, 커뮤니티/채널 구조, 유저 설정입니다.
6. **이동은 서버가 검증한다.** 클라이언트는 입력 또는 목표 좌표를 제한된 빈도(초당 10~15회)로 보내고, 서버가 맵 경계, 충돌, 이동 속도를 검증한 뒤 브로드캐스트합니다. 다른 유저 캐릭터는 클라이언트에서 보간해서 그립니다.
7. **맵은 데이터로 정의하고, 배치와 겉모습을 나눈다.**
   - 분수 광장과 모닥불 캠프는 코드 분기가 아니라 맵 정의로 구분합니다. 서버의 이동 검증과 클라이언트 렌더링이 같은 맵 정의를 읽습니다.
   - 맵 정의는 **배치**(크기, 충돌 영역, 스폰 지점)와 **겉모습**(타일셋, 장식, 장식 애니메이션)으로 나눕니다. 배치는 맵마다 하나, 겉모습은 테마마다 하나입니다.
   - 테마는 겉모습만 바꾸고 배치는 바꾸지 않습니다. 그래서 테마가 바뀌어도 서버의 이동 검증은 영향을 받지 않습니다. 배치까지 바뀌어야 하는 테마가 생기면 사용자와 먼저 정합니다.
   - 처음부터 맵을 불러올 때 테마 키를 받도록 만듭니다. 처음에는 `default` 하나만 있어도, 이후 테마 추가가 에셋 추가만으로 끝나야 합니다.
8. **분할 화면은 채널 하나와 그 광장을 본다.**
   - 채팅 패널은 지금 연 텍스트 채널(또는 DM)을, 메타버스 패널은 그 채널이 속한 광장을 보여줍니다. 두 패널은 각각 켜고 끌 수 있고, 한쪽이 꺼져도 다른 쪽이 동작해야 합니다.
   - 음성 채널을 누르면 통화에 들어가고, 채팅 패널은 보던 텍스트 채널을 유지합니다.
   - 추후 멀티 분할을 위해, 패널 컴포넌트는 전역 상태를 직접 읽지 말고 `channelId` / `plazaId`를 prop으로 받습니다.
9. **키보드 포커스를 분리한다.** 방향키는 메타버스 패널에 포커스가 있을 때만 캐릭터를 움직입니다. 채팅 입력창에 포커스가 있으면 어떤 키도 캐릭터를 움직이지 않습니다.
10. **통화와 근접 음성**
    - 통화 단위는 음성 채널 또는 DM입니다. 한 사람은 동시에 통화 하나에만 참여합니다 (Discord와 동일).
    - 음성 채널에 들어가도 캐릭터는 커뮤니티 광장에 그대로 있습니다. 광장의 캐릭터에는 참여 중인 음성 채널과 말하는 중 이펙트를 표시하고, 이 표시는 광장을 보는 모든 사람에게 보입니다.
    - 근접 음성은 통화마다의 설정입니다 (`Channel.proximityVoice`). 그 통화 참여자 누구나 바꿀 수 있고, 바뀌면 참여자 전원에게 알립니다.
    - ON이면 같은 통화 참여자끼리만, 서버가 가진 광장 위치로 거리를 계산합니다. 반경 밖 참여자의 오디오 트랙은 구독하지 않고(실제로 안 들리고 대역폭도 아낌), 반경 안에서는 거리에 따라 볼륨을 줄입니다.
    - 다른 통화 참여자의 음성은 거리와 상관없이 절대 섞이지 않습니다.
11. **캐릭터·맵 에셋은 교체 가능해야 한다.** 에셋(도트)은 나중에 들어옵니다. 렌더링 코드는 특정 이미지에 의존하지 말고 스프라이트시트 + 매니페스트(애니메이션 이름, 프레임, 크기)와 타일셋을 읽는 구조로 만들고, 그때까지는 플레이스홀더를 씁니다. 첨부 모션도 매니페스트의 애니메이션 이름으로 참조해서, 에셋이 들어오면 임시 표시를 코드 수정 없이 교체할 수 있게 합니다.
12. **이벤트 규격은 `packages/shared`에만 정의한다.** 소켓 이벤트 이름, 페이로드 타입, zod 스키마는 공용 패키지에 두고 클라이언트와 서버가 import합니다. 서버는 들어오는 모든 페이로드를 zod로 검증합니다.
13. **웹 코드는 Electron을 모른다.**
    - `apps/web`은 `electron`을 import하지 않습니다. 데스크톱 전용 기능(로그인, 네이티브 알림, 트레이, 자동 업데이트)은 preload가 노출하는 브리지(`window.metacode`)를 통해서만 쓰고, 브리지 타입은 `packages/shared`에 둡니다.
    - 브리지가 없으면(브라우저) 웹 대체 동작으로 돌아가야 합니다.
    - Electron 보안 설정: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. 원격 콘텐츠에 Node 권한을 주지 않습니다.

## 실시간 이벤트 규칙

- 이름은 `도메인:동작` 형식입니다. 도메인: `message`, `channel`, `plaza`, `presence`, `voice`, `typing`
- 클라이언트 → 서버는 명령형, 서버 → 클라이언트는 과거형으로 짓습니다.
  - `message:send` → `message:created`
  - `typing:start` → `typing:started` (보낸 연결 제외)
  - `channel:created`, `dm:created`, `community:member-joined` / `member-left` / `deleted`, `presence:changed`
  - `plaza:watch` / `plaza:unwatch`: 광장 화면을 열고 닫을 때 (위치 업데이트 구독)
  - `plaza:move` → `plaza:moved`
  - 광장 인원 변화 → `plaza:roster`
  - `voice:join` / `voice:leave` → `voice:joined` / `voice:left`
  - `voice:setProximity` → `voice:proximityChanged`
- Socket.IO room 이름은 `user:<userId>`, `community:<communityId>`, `channel:<channelId>`, `plaza:<plazaId>` 형식을 씁니다.
- 이벤트 이름과 페이로드 타입은 `packages/shared/src/events`의 `SocketEvent`, `ClientToServerEvents`, `ServerToClientEvents`에만 정의합니다.

## 인증 흐름

구현: `apps/server/src/auth/`, `apps/desktop/src/main/auth.ts`, `apps/web/src/api/client.ts`

- **토큰**
  - 액세스 토큰: JWT(HS256), 15분
  - 리프레시 토큰: 무작위 값, 30일. DB에는 SHA-256 해시만 저장합니다.
  - 리프레시할 때마다 새 토큰으로 교체하고, 같은 로그인에서 나온 토큰은 `familyId`로 묶습니다.
  - 교체된 지 30초가 지난 토큰이 다시 오면 탈취로 보고 family 전체를 폐기합니다. 30초 안이면 동시 요청(탭 두 개)으로 보고 401만 돌려줍니다.
- **웹**
  - `GET /auth/github?client=web` → GitHub → `/auth/github/callback` → HttpOnly 쿠키 발급 → `WEB_ORIGIN`으로 이동
  - 쿠키: `mc_access`(path `/`), `mc_refresh`(path `/auth`), SameSite=Lax. `WEB_ORIGIN`이 https면 Secure를 붙입니다.
  - login CSRF 방지: 로그인 시작 때 state를 `mc_oauth_state` 쿠키에도 심고, 콜백에서 쿼리 state와 같은지 확인합니다.
  - 실패하면 `WEB_ORIGIN/?login_error=<사유>`로 돌려보냅니다.
- **데스크톱**
  - 메인 프로세스가 PKCE verifier를 만들고 `127.0.0.1`의 임의 포트에 일회용 수신 서버를 연 뒤, `GET /auth/github?client=desktop&code_challenge=...&redirect_port=<포트>`를 시스템 브라우저로 엽니다.
  - 콜백은 일회용 코드(60초)를 붙여 브라우저를 `http://127.0.0.1:<포트>/callback?code=`로 보냅니다. 서버는 `127.0.0.1`로만 보내므로 임의 주소로 돌려보내는 데 악용될 수 없습니다.
  - 앱은 결과를 한 번 받으면 수신 서버를 닫고, `POST /auth/desktop/token {code, codeVerifier}`로 토큰을 받습니다. code를 알아낸 다른 프로그램은 verifier가 없어서 토큰을 받을 수 없습니다.
  - 로그인을 시작하고 5분 안에 결과가 오지 않으면 수신 서버를 닫습니다.
  - 리프레시 토큰은 메인 프로세스가 `safeStorage`로 암호화해 보관합니다. 렌더러는 브리지로 액세스 토큰만 받아 `Authorization: Bearer`로 보냅니다.
  - Electron 창 안에서 GitHub 로그인 페이지를 직접 띄우지 않습니다.
- **WebSocket:** 핸드셰이크에서 인증합니다. 웹은 쿠키, 데스크톱은 `auth.token`을 씁니다. 실패하면 서버가 연결을 끊고, 웹은 세션을 갱신한 뒤 한 번 다시 연결합니다.
- **보호된 API:** `@UseGuards(AuthGuard)` + `@CurrentUserId()`. `AuthGuard`는 전역 `AuthCoreModule`에 있어서 어느 모듈에서든 쓸 수 있습니다.

## 도메인 모델

`apps/server/prisma/schema.prisma`가 기준입니다. 바꾸면 여기도 고칩니다.

- `User` (구현됨): githubId, username, displayName, avatarUrl. characterId는 Phase 6에서 추가
- `RefreshToken` (구현됨): userId, tokenHash, familyId, client, expiresAt, revokedAt
- `Community` (구현됨): name, ownerId / `CommunityMember`: userId, communityId, role(`OWNER` | `ADMIN` | `MEMBER`) / `Invite`: code(8자), expiresAt(7일), uses
- `Channel` (구현됨): type(`TEXT` | `VOICE` | `DM` | `GROUP_DM`), communityId(DM이면 null), name, position, proximityVoice, dmKey(1:1 DM 중복 방지)
  - `ChannelMember`: DM 참여자. 커뮤니티 채널의 접근은 커뮤니티 멤버십(추후 채널 권한)으로 판단
  - 광장은 테이블이 아닙니다. 채널에서 계산합니다: `TEXT`·`VOICE` → `community:<communityId>`(분수 광장), `DM`·`GROUP_DM` → `dm:<channelId>`(모닥불 캠프)
- `Message` (구현됨): channelId, authorId, content(최대 4000자), createdAt. id가 UUIDv7이라 id 순서 = 시간 순서
- `ChannelReadState` (구현됨): channelId, userId, lastReadMessageId. 앞으로만 옮긴다
- `Attachment` (구현됨): channelId(권한 판단), uploaderId, messageId(보내기 전 null), status(`PENDING` | `READY`), kind(`IMAGE` | `FILE`), objectKey, thumbnailKey, fileName, contentType, size, width, height
- `Character`: 에셋 키, 커스터마이징 값

## 도트 에셋 규격

크기는 확정, 나머지는 Phase 4~6에서 이 기준으로 구현합니다.

- **크기 (확정):** 타일 16×16px, 캐릭터 한 프레임 16×32px (가로 1타일, 세로 2타일).
- **확대:** 화면에는 정수배로만 확대합니다 (기본 3배, 사용자가 2~4배 선택). Phaser는 `pixelArt: true`, `roundPixels: true`로 설정하고, 패널 크기가 바뀌면 정수 배율을 다시 계산합니다. 2.5배 같은 소수 배율은 쓰지 않습니다.
- **카메라:** 모닥불 캠프(약 16×12타일)는 맵 전체가 패널에 들어오는 가장 큰 정수 배율로 보여주고, 분수 광장(약 48×36타일 이상)은 배율을 고정하고 카메라가 내 캐릭터를 따라갑니다.
- **캐릭터 기준점:** 발밑 가운데입니다. 충돌 판정은 발 영역(약 10×6px)만 쓰고, y좌표 순서로 앞뒤를 그려서 분수나 모닥불 뒤로 지나갈 때 가려지게 합니다.
- **스프라이트시트 배치:** 행은 방향(아래, 왼쪽, 오른쪽, 위), 열은 프레임입니다. 커스터마이징 부품(몸, 머리카락, 옷)은 같은 배치로 따로 그려서 실행 중에 겹칩니다.
- **글자:** 말풍선과 이름표의 글자는 도트 배율로 키우지 않습니다. 화면 해상도로 렌더링하거나 한글 도트 폰트(Galmuri 등 오픈 라이선스)를 씁니다. 말풍선 틀은 도트로 그려도 됩니다.
- **제작 도구 (권장):** 캐릭터와 타일은 Aseprite(PNG + JSON 내보내기), 맵은 Tiled(JSON 내보내기). Phaser가 두 형식을 바로 읽고, 서버도 Tiled JSON에서 충돌 영역을 읽습니다.
- **테마별 타일셋:** 같은 맵의 테마별 타일셋은 **칸 배치를 똑같이** 그립니다 (같은 위치의 칸 = 같은 역할. 예: 봄의 잔디 칸 자리에 겨울에는 눈 덮인 땅). 그러면 Tiled 맵 하나가 모든 테마 타일셋으로 그대로 동작합니다.
- **테마 전용 장식:** 크리스마스 트리처럼 특정 테마에만 있는 장식은 별도 레이어에 두고, 이동을 막지 않게 합니다 (배치를 바꾸지 않는 원칙).

## 디렉터리 구조 (예정)

```
apps/web/src/
  features/auth/        # GitHub 로그인
  features/chat/        # 채팅 모드
  features/metaverse/   # 메타버스 모드 (Phaser 씬, 캐릭터, 말풍선)
  features/voice/       # 음성 채널, DM 통화, 근접 음성
  layout/               # 사이드바, 분할 화면
  platform/             # 웹/데스크톱 차이를 감추는 계층 (window.metacode 브리지 사용)
apps/desktop/src/
  main/                 # Electron 메인 프로세스 (창, 로그인, 알림, 자동 업데이트)
  preload/              # window.metacode 브리지
apps/server/src/
  auth/ community/ channel/ message/ upload/ plaza/ voice/ presence/
packages/shared/src/
  events/               # 소켓 이벤트 이름, 페이로드 타입, zod 스키마
  domain/               # 공용 도메인 타입, 표현 판정 함수, getPlazaId
  maps/                 # 광장 맵 정의 (배치: 크기, 충돌, 스폰 지점)
  desktop/              # window.metacode 브리지 타입
assets/
  characters/           # 캐릭터 스프라이트시트 + 매니페스트
  maps/<맵>/            # Tiled 맵 (배치)
  maps/<맵>/themes/<테마>/  # 테마별 타일셋, 장식 (default, winter ...)
```

## 작업 방식

- 작업은 `dev`에서 `feature/<요약>` 브랜치를 따서 하고, PR 대상은 `dev`입니다. 커밋은 Conventional Commits를 따릅니다 (README 참고).
- README 로드맵 순서대로 진행합니다. 한 작업은 로드맵 항목 하나 정도의 크기로 나눕니다.
- 채팅이나 메시지 관련 기능을 만들 때는 **두 모드에서 각각 어떻게 보이는지**를 같이 정합니다. 한쪽만 구현하고 끝내지 않습니다.
- UI 기능을 만들면 웹과 데스크톱 앱 양쪽에서 동작하는지 확인합니다.
- 비밀값(GitHub OAuth client secret, JWT secret, LiveKit API key 등)은 `.env`에만 두고 커밋하지 않습니다. 새 환경변수를 추가하면 `.env.example`도 갱신합니다.
- 다음은 진행 전에 사용자에게 확인받습니다:
  - 기술 스택 확정이나 변경, 새 외부 서비스/유료 서비스 도입
  - DB 스키마의 큰 변경이나 파괴적 마이그레이션
  - 위 "확정된 결정"을 바꾸는 일, 아래 "미결정 사항"에 해당하는 결정

## 명령어

루트에서 실행합니다. 처음 설정은 README "시작하기"를 봅니다.

| 명령어 | 설명 |
| --- | --- |
| `pnpm dev` | web(5173) + server(3000) + shared watch |
| `pnpm dev:desktop` | 위 + Electron 앱 |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | turbo로 전체 실행 |
| `pnpm lint` / `pnpm format:check` | 루트에서 ESLint / Prettier |
| `pnpm --filter @metacode/<패키지> <스크립트>` | 패키지 하나만 실행 (예: `pnpm --filter @metacode/shared test`) |
| `pnpm infra:up` / `pnpm infra:down` | 로컬 PostgreSQL, Redis, SeaweedFS(S3) |
| `pnpm --filter @metacode/server db:migrate` | 스키마 변경 → 마이그레이션 생성 + 로컬 DB 적용 (`--name <이름>`) |
| `pnpm --filter @metacode/server db:deploy` | 만들어 둔 마이그레이션만 적용 (운영, CI) |

작업을 마치기 전에 `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`가 통과하는지 확인합니다 (CI와 같은 순서).

## 미결정 사항

사용자와 정해야 하는 항목입니다. 정해지면 이 목록에서 지우고 "확정된 결정"에 옮깁니다.

테마 기능을 만들기 전까지 정하면 됩니다.

- 테마 적용 주체: 운영자가 전체에 일괄 적용(기간 예약)하는지, 커뮤니티 관리자가 고르는지, 둘 다인지
- 테마 범위: 광장 맵만인지, 캐릭터 소품(모자 등)까지인지, 채팅 UI까지인지
