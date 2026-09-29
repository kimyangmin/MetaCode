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

- **Phase 1~6 완료.** Phase 7을 먼저 진행하다가 2026-09-28 Phase 6(에셋)을 했습니다: CC0 에셋팩으로 기본 지형·캐릭터, 캐릭터 애니메이션·첨부 모션, 도트 에디터, 캐릭터 고르기, 맵 에디터. PR은 `feature/asset-format` → `builtin-maps` → `character-animation` → `asset-editor` → `character-select` → `map-editor` 순서로 이어져 있습니다 (#33~#38). 운영 서버의 음성 통화는 2026-09-27에 켰습니다 (`docs/deploy.md` 10단계: 7882/udp, 7881/tcp, `.env.production`의 LiveKit 키).
- **운영 중:** https://metacode.kimyangmin.me (2026-09-26 첫 배포, `main` 기준). 서버는 SSH 별칭 `myserver3`(ubuntu, `~/MetaCode`)로 접속할 수 있고, 업데이트는 `main`에 push되면 CI 통과 후 GitHub Actions가 SSH로 `infra/deploy.sh`를 실행해 자동으로 합니다 (배포 전용 키는 `authorized_keys`의 `command=`로 이 스크립트만 실행 가능, 설정은 `docs/deploy.md` 9단계). 손으로 할 때는 서버에서 `bash infra/deploy.sh`입니다. DB 백업은 서버 crontab이 매일 04:00 KST(19:00 UTC)에 `infra/backup.sh`를 실행합니다 (`~/MetaCode/backups/`, 14일 보관, 로그 `backups/backup.log`). 운영 서버에서 무언가를 바꾸기 전에는 사용자에게 확인받습니다.
- Phase 7 진행 중: 데스크톱 자동 업데이트(GitHub Releases, `desktop-v*` 태그) 완료. 코드 서명은 정식 공개 때 정합니다.
- 개발용 GitHub OAuth App(`localhost` 콜백)으로 웹·데스크톱, 운영용 OAuth App으로 운영 웹의 실제 로그인을 확인했습니다 (2026-09-26).
- 기술 스택은 README 표대로 확정되었습니다 (2026-09-26). 메타버스 렌더링은 Phaser 3 대신 Phaser 4로 정했습니다 (2026-09-27).
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
  - LiveKit은 음성용 포트 7882/udp와 7881/tcp를 따로 열어야 합니다 (포트 범위 대신 UDP 포트 하나에 모아서 씀, `docs/deploy.md` 10단계).
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
- **초대 링크로 앱 열기 (데스크톱 0.4.0):** `apps/desktop/src/main/deeplink.ts`, 웹 `features/desktop/OpenInApp.tsx`, `inviteLink.ts`
  - 로그인과 별개로 `metacode://`를 씁니다. 받는 주소는 `metacode://invite/<코드>` 하나뿐이고, URL로 풀지 않고 글자 그대로 정규식으로 맞춥니다 (`new URL`은 `../`를 풀어서 다른 경로가 통과했음, 테스트 있음).
  - 설치한 앱만 `setAsDefaultProtocolClient`로 등록합니다 (개발용 앱이 가져가지 않게, 확인하려면 `METACODE_REGISTER_PROTOCOL=1`). electron-builder의 `protocols`에도 적었습니다.
  - 받는 곳: 처음 켤 때는 실행 인자, 이미 켜져 있으면 Windows·Linux는 `second-instance`의 인자, macOS는 `open-url`. 창이 없으면 `#/invite/<코드>`로 열고, 떠 있으면 IPC `metacode:navigate` → 브리지 `navigation.onNavigate`로 웹 라우터가 옮깁니다 (새로 고치지 않아 통화가 끊기지 않음). 로그인 전이면 초대를 기억했다가 로그인 뒤 이어 갑니다.
  - 웹: Windows·macOS·Linux 브라우저에서 `/invite/<코드>`를 열면 먼저 "데스크톱 앱에서 여는 중" 화면이 뜨고 한 번 `metacode://`로 열어 봅니다 (브라우저의 "MetaCode 열기" 확인). "브라우저에서 계속"을 누르면 그 탭에서는 그 초대를 다시 묻지 않습니다 (sessionStorage). 앱이 없는 기기(iPad — iPadOS Safari는 Mac이라고 알리므로 터치 지점 수로 가림 —, Android, ChromeOS)에서는 묻지 않습니다 (`desktopOs`).
  - 여는 방법(`appOpenMethod`): Chromium 계열은 앱이 없으면 조용히 넘어가므로 페이지를 옮기고, Safari·Firefox는 앱이 없으면 경고 창이나 오류 페이지로 바뀌므로 숨긴 iframe으로 열어 봅니다. "앱에서 열기" 버튼은 `metacode://` 링크라 사용자가 누르면 어느 브라우저든 열립니다.
  - 0.3.x 이하 앱은 프로토콜을 등록하지 않았으므로, 앱을 0.4.0으로 업데이트해야 동작합니다. 0.4.0에는 화면 공유 보기 창 떼어 내기(`isScreenPopup`)도 들어 있습니다.
- **채팅 구조 (Phase 2):**
  - 서버: `apps/server/src/chat/`. 권한 판단은 `AccessService` 한 곳에서 합니다 (권한 없으면 존재 여부도 숨기려고 404).
  - 실시간: `ChatGateway`가 접속 때 인증하고, 볼 수 있는 커뮤니티/채널 방에 넣습니다. 메시지는 방 단위로만 보내므로 권한 없는 채널의 메시지는 받지 않습니다. 멤버십이 바뀌면(참여, 탈퇴, 채널 생성, DM 생성) HTTP 쪽 서비스가 `RealtimeService`로 방 구성을 바로 고칩니다.
  - 메시지 보내기는 WebSocket(`message:send` + ack), 기록 조회와 읽음 처리는 HTTP입니다.
  - PostgreSQL에는 uuid용 `max()`가 없어서 채널별 최신 메시지는 `DISTINCT ON`으로 구합니다 (`ChannelSummaryService`).
  - 웹: `RealtimeProvider`가 소켓 하나를 유지하고 서버 이벤트로 TanStack Query 캐시를 고칩니다. 온라인 상태와 입력 중 표시는 zustand 스토어에 둡니다. 재연결하면 전체 쿼리를 다시 불러옵니다.
  - 메시지 목록은 `column-reverse`로 그려 맨 아래가 기준점입니다. 이전 기록은 위쪽 끝 요소를 IntersectionObserver로 감지해 불러옵니다 (페이지가 그려지지 않는 숨은 탭에서는 동작하지 않음).
  - 입력창은 한글 조합 중 Enter(`isComposing`, keyCode 229)로 보내지 않습니다.
  - 라우터: 웹은 일반 주소, 데스크톱은 해시 주소(`#/c/...`). 로그인 전에 연 초대 링크는 sessionStorage에 기억했다가 로그인 후 이어 갑니다.
  - 수정·삭제: 내가 보낸 메시지만 (우클릭 메뉴). `message:edit`(ack로 고친 메시지) → `message:updated`, `message:delete` → `message:deleted {channelId, messageId, lastMessageId}`. 고치면 `editedAt`이 남고 "(수정됨)"을 보여 주며, 첨부 없는 메시지는 글을 비울 수 없습니다. 지우면 첨부도 DB에서 연쇄 삭제되고 저장소 파일은 서버가 지웁니다. 답장의 원래 메시지 표시는 고치면 글이 바뀌고 지우면 비워지며(클라이언트 캐시도 같은 규칙, `updateMessageInCache`/`removeMessageFromCache`), `lastMessageId`로 채널의 안 읽음 표시를 맞춥니다. 광장은 떠 있는 말풍선의 글을 바꾸거나 내립니다.
  - 아직 없는 것: 보내기 속도 제한, 모바일 화면(가로 1000px 미만이면 멤버 목록만 숨김).
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
- **광장 (Phase 4):** `packages/shared/src/plaza/`(충돌 격자 `MapLayout`, 이동 규칙, 이벤트), `apps/server/src/plaza/`, `apps/web/src/features/metaverse/`, `apps/web/src/layout/SplitView.tsx`
  - 광장 ID는 `community:<id>` 또는 `dm:<channelId>`. 클라이언트가 `plaza:watch`(ack로 전체 상태)로 방 `plaza:<id>`에 들어가고, 나갈 때 `plaza:unwatch`. 다시 연결되면 방 참여가 끊기므로 `connect` 때마다 다시 연다.
  - 이동: 클라이언트가 자기 캐릭터를 먼저 움직이고 `MOVE_SEND_INTERVAL_MS`(100ms)마다, 멈출 때 한 번 더 `plaza:move`를 보낸다. 서버는 `isValidMove`(마지막으로 받은 위치에서 속도 ×1.5 + 4px 이내, 4px 간격으로 장애물 확인)로 검사해 통과하면 같은 방의 다른 연결에만 `plaza:moved`, 아니면 보낸 연결에 `plaza:corrected`. 방에 없는 연결의 이동은 무시한다.
  - 위치는 Redis 해시 `plaza:pos:<plazaId>`에만 둔다(휘발성). 처음이면 사용자 ID 해시로 스폰 영역 안의 칸을 고른다. 인원(온라인 멤버)이 바뀌면 `plaza:member`(occupant 또는 null)로 알린다: 접속/끊김, 커뮤니티 참여/탈퇴.
  - 다른 사람 캐릭터는 받은 위치를 150ms 늦게 그리며 사이를 보간하고(`RemoteTrack`), 64px 넘게 튀면 바로 옮긴다. 클릭 이동은 A*(8방향, 모서리 파고들기 금지) 경로를 따라간다.
  - 맵 = 맵 정의(`MapDefinition`). 스냅샷(`plaza:watch` ack)의 `definition`으로 오고, 서버와 클라이언트가 같은 정의에서 `buildCollision`으로 충돌 격자를 만든다. 내장 맵은 `packages/shared/src/assets/builtin-maps.ts`(코드로 칠한 Kenney 타일 + 분수·모닥불 등 오브젝트, `BUILTIN_MAPS`/`BUILTIN_LAYOUTS`).
  - 그리기(`mapView.ts`): 정지 타일은 층(바닥, 장식)마다 캔버스 한 장으로 합치고, 움직이는 타일(물)과 오브젝트는 따로 두어 매 프레임 `frameAt`으로 프레임을 맞춘다. 에셋 하나 = 텍스처 하나(프레임 i = 텍스처 프레임 i, `asset:<참조>`). 깊이: 바닥 0 < 장식 0.2 < 클릭 표시·그림자·고리 < 캐릭터(발밑 y)·오브젝트(그림 아래쪽 끝 y). 16×16 solid 타일은 캐릭터를 가릴 일이 없어서(캐릭터는 발에서 위로만 그림) 타일 층에 두고, 두 칸 이상 높은 것만 오브젝트로 둔다.
  - `art.ts`에는 그림자, 클릭 표시, 말하는 중 고리만 남긴다. 매니페스트 → 캔버스 변환(`framePixels`, `sheetCanvas`, `frameAt`)은 `features/assets/render.ts`에 있다 (도트 에디터도 씀).
  - 배율(`camera.ts`): 작은 맵(20×16타일 이하, 모닥불 캠프)은 맵 전체가 들어오는 가장 큰 정수, 넓은 맵(분수 광장)은 기본 3배이고 패널이 좁으면(10×8타일이 안 보이면) 낮춘다. 사용자가 배율을 고르는 UI는 아직 없다.
  - 말풍선: `message:created`를 채팅과 같이 받아서, 이 광장의 채널(분수 광장은 커뮤니티의 모든 텍스트 채널, 캠프는 그 DM)이면 작성자 위에 띄운다. 서버가 볼 수 있는 채널의 메시지만 보내므로 읽기 권한이 그대로 반영된다. 80자에서 줄이고, 글 길이에 따라 3~8초, 한 사람에 최대 3개까지 쌓는다. 첨부 메시지는 캐릭터의 첨부 모션(`emote`, 한 번 재생 + 제자리 뛰기)과 머리 위의 작은 표시(`🖼️ N` / `📎 N`, 2.5초).
  - 이름표와 말풍선은 캔버스가 아니라 위에 겹친 DOM에 그린다(글자를 도트 배율로 키우지 않는 규칙). 패널 가장자리에서는 말풍선을 안쪽으로 밀고 꼬리만 캐릭터를 가리킨다.
  - 키보드: Phaser의 키보드 입력은 끄고(창 전체의 키를 가로채므로), 광장 패널(`tabIndex=0`)의 keydown/keyup으로만 받는다. 광장을 누르면 포커스가 가고, 채팅 입력창의 키는 캐릭터를 움직이지 않는다. 창이 포커스를 잃으면 눌린 키를 비운다.
  - 포커스 옮기기(`layout/panelFocus.ts`, `SplitView`): Shift+Tab은 광장 ↔ 채팅 입력창, 광장에서 `/`는 채팅 입력창으로 (`/`는 입력되지 않음). 옮길 패널이 접혀 있으면 펼치고, 광장처럼 펼칠 때 새로 그려지는 패널은 몇 프레임 기다렸다 포커스를 줍니다. Shift+Tab은 분할 화면 안(또는 아무 데도 포커스가 없을 때)에서만 가로채고 대화 상자 등에서는 원래대로 둡니다.
  - 분할 화면: react-resizable-panels v4. 두 패널 모두 접을 수 있고(채팅 최소 300px, 광장 240px), 크기와 접힘은 localStorage에 기억한다. 접힌 채팅은 입력 중이던 글이 남도록 그대로 두고(`inert`), 접힌 광장은 내려서(Phaser 게임 제거, `plaza:unwatch`) 그리기와 구독을 멈춘다. 보기 전환 버튼은 보이는 첫 패널의 머리글에 있다.
  - Phaser는 약 1.4MB라 광장을 처음 열 때 따로 불러온다(`React.lazy`).
  - 캐릭터(`characterSprite.ts`): 고른 캐릭터(없으면 `defaultCharacter(userId)`, 사용자 ID로 고른 기본 캐릭터와 색)를 `characterPalette`로 색을 바꿔 텍스처 하나로 만들고, 같은 모습이면 함께 쓴다(`char:<characterKey>`). 멈추면 `idle-<방향>`, 움직이면 `walk-<방향>`(120ms 동안 안 움직여야 멈춘 것으로 봄, 받은 위치 사이에서 걷기가 끊기지 않게), 첨부 메시지면 `emote`를 한 번. 애니메이션이 바뀔 때 처음 프레임부터 튼다.
- **음성 통화 (Phase 5):** `apps/server/src/voice/`, `apps/web/src/features/voice/`, `packages/shared/src/voice/`
  - LiveKit(셀프 호스팅, WebRTC SFU)이 음성을 나르고, 서버는 입장권(JWT)을 만들고 통화 목록과 상태를 관리합니다. 채널 하나 = LiveKit 방 `channel-<channelId>`, 신원 = 사용자 ID (같은 사람이 다른 곳에서 들어오면 LiveKit이 앞의 연결을 끊음). 입장권은 마이크만 올릴 수 있습니다.
  - 통화 상태는 서버 메모리에 둡니다 (Presence와 같이 서버 한 대 전제). 통화는 들어간 실시간 연결(socket)에 묶이고, 그 연결이 끊긴 뒤 `VOICE_DISCONNECT_GRACE_MS`(15초) 안에 다시 들어오지 않으면 빼고 LiveKit에서도 끊습니다. 서버가 다시 시작하면 웹 클라이언트가 `connect` 때 `voice:join`을 다시 보내 묶습니다 (이미 LiveKit에 붙어 있으면 새 입장권은 버림).
  - 한 사람은 통화 하나: 다른 통화에 들어가면 서버가 앞의 통화에서 빼고 `voice:left`를 본인 방에도 보냅니다. 다른 기기의 클라이언트는 이것을 받고 연결을 끊습니다.
  - 이벤트 대상: 통화 목록과 상태는 `channel:<id>` 방(음성 채널이면 커뮤니티 멤버 전원, DM이면 참여자)으로 보내므로, 통화에 없는 사람도 목록과 광장 표시를 봅니다.
  - 근접 음성: 서버가 광장 위치(Redis)로 참여자 쌍마다 음량을 계산해(`proximityGain`: 3타일 안 1, 10타일 밖 0, 0.1 단위) 바뀐 사람에게만 `voice:gains`로 보냅니다. 광장 이동(`plaza:move` 통과), 통화 참여/나감, 켜기 때 다시 계산합니다. 클라이언트는 LiveKit 자동 구독을 끄고, 0이면 구독을 끊고 아니면 그 음량으로 틉니다 (`volumeFor`). 구독 여부는 `isSubscribed`가 아니라 `isDesired`로 판단합니다 (구독 요청 중에 끊지 못하는 문제가 있었음). 설정은 `Channel.proximityVoice`에 저장합니다.
  - 말하는 중: 각 클라이언트가 보내는 마이크 트랙의 음량을 직접 재서(`micLevel.ts`의 AudioWorklet이 20ms마다 RMS, `speech.ts`의 `SpeechDetector`가 -45dBFS 이상 40ms면 켜고 조용한 지 300ms면 끔) `voice:update`로 서버에 보내고 서버가 알립니다. 내 표시는 서버를 기다리지 않고 바로 바꿉니다. LiveKit의 음성 감지(`IsSpeakingChanged`)는 서버가 음량을 400ms씩 모아 판정해서 1~2초 늦으므로, 직접 잴 수 없을 때(AudioWorklet 불가, AudioContext 멈춤)에만 씁니다. 타이머 대신 AudioWorklet을 쓰는 이유는 가려진 창에서 타이머가 늦어지기 때문입니다. 채팅 모드 목록(아바타 초록 테두리)과 광장(발밑 고리, 이름표 테두리, 캐릭터 위 `🔊 채널`/`📞 통화 중`)에 보입니다.
  - 마이크가 없거나 권한이 없으면 듣기만 합니다(`listenOnly`, 음소거로 알림). 헤드셋을 끄면 마이크도 끄고 모든 구독을 끊습니다. 장치 선택은 localStorage에 기억합니다.
  - LiveKit 클라이언트(약 500KB)는 처음 통화에 들어갈 때 불러옵니다. 통화 제어는 React 밖의 `VoiceController`, 상태는 zustand(`useVoiceStore`)에 둡니다.
  - 로컬: `infra/docker-compose.yml`의 `livekit` (키 `devkey`, NODE_IP 127.0.0.1). 운영: `COMPOSE_PROFILES=voice`일 때만 뜨고, 신호는 Caddy가 `https://<API_DOMAIN>/livekit`으로 넘깁니다 (livekit-client가 주소의 경로를 유지함). 키가 비어 있으면 서버는 음성만 끈 채로 뜹니다.
  - 화면 공유: 통화 중인 사람이 음성 패널의 🖥️로 공유합니다 (영상 + 가능하면 시스템 소리). 상태는 `voice:update`의 `sharing`으로 알려 목록과 광장(`🖥️`)에 보이고, 목록의 LIVE를 누르면 보기 창이 뜹니다 (그 통화에 없으면 먼저 들어감). 영상과 공유 소리는 **보고 있는 동안에만** 구독합니다 (`trackVolume`). 입장권은 마이크, 화면 공유 영상, 화면 공유 소리만 올릴 수 있습니다.
  - 미리보기: 참여자 목록(과 DM 머리글)의 공유 중인 사람에게 마우스를 0.3초 올리면 옆에 작게 띄웁니다. 같은 통화에 있을 때만 그 사람의 화면 영상을 받고(소리는 안 받음), 마우스를 떼면 구독을 끊습니다 (`previewing`, `SharePreview.tsx`).
  - 화질(`screenQuality.ts`): 공유를 시작할 때 고릅니다 (부드럽게 720p60 / 선명하게 1080p30 / 최고 1080p60, 기본 최고, localStorage에 기억). 게임 공유가 끊기지 않게 H.264(하드웨어 인코딩), 시뮬캐스트 끔, `degradationPreference: maintain-framerate`(대역폭이 모자라면 해상도를 먼저 낮춤), `contentHint: motion`으로 보냅니다. 사용자가 적어(8명 안팎) 서버 부담보다 화질을 우선합니다.
  - 받고 있는 화면 영상은 `VoiceConnection.screens`에 사람별로 기억합니다. 미리보기로 받던 영상을 LIVE로 크게 볼 때는 구독이 새로 생기지 않아 `TrackSubscribed`가 오지 않으므로, `watch`/`preview`가 기억한 영상을 바로 넘깁니다 (예전엔 "불러오는 중"에서 멈췄음).
  - 보기 창(`ScreenViewer.tsx`)은 떠 있는 창입니다: 머리글을 끌어 옮기고 가장자리·모서리를 끌어 크기를 바꿉니다(위치·크기는 localStorage, `floatingFrame.ts`). 크게 보기(머리글 두 번 누르기), 전체 화면(⛶ 또는 영상 두 번 누르기, `useFullscreen.ts`), ⧉로 새 창 분리. 전체 화면은 영상 영역(`.screen-viewer__stage`)을 `requestFullscreen`하고, 거절되면 창 안을 꽉 채웁니다(Esc로 끝냄). 데스크톱 0.4.0까지는 권한 처리기에 `fullscreen`이 빠져 있어 늘 거절되었고 0.4.1부터 허락합니다. 분리한 창은 같은 출처의 빈 창(`openPopupWindow`, 이름 `metacode-screen`)에 메인 창이 React 포털로 그리는 것이라 통화 연결을 새로 만들지 않습니다 (같은 신원으로 두 번 들어가면 LiveKit이 앞의 연결을 끊음). 데스크톱은 이 빈 창을 `isScreenPopup`으로 허락합니다 (0.4.0부터, 이전 앱은 안내만).
  - 데스크톱 화면 공유: Electron의 getDisplayMedia는 고르는 창이 없어서, 웹이 브리지(`screen.getSources`)로 받은 목록을 보여 주고 고른 것(`screen.select`, 30초 유효)을 메인 프로세스의 `setDisplayMediaRequestHandler`가 넘겨줍니다. 고르지 않은 요청과 앱 화면이 아닌 요청은 거절합니다. 시스템 소리(loopback)는 Windows에서만 됩니다. 데스크톱 0.1.0에는 이 브리지가 없어서 "새 버전 설치" 안내가 뜹니다.
  - 데스크톱: Electron은 권한 처리기가 없으면 모든 권한을 허락하므로, 앱 화면에만 마이크·스피커 선택·클립보드 쓰기·전체 화면을 허락하고 나머지(카메라 포함)는 거절합니다 (`apps/desktop/src/main/permissions.ts`).
  - 로컬에서 두 사람 음성 확인: 브라우저 패널은 마이크를 막으므로, 두 번째 사용자는 `@livekit/rtc-node`로 음을 보내는 스크립트로 확인했습니다. 실제 마이크로 말하는 확인은 사람이 해야 합니다.
- **데스크톱 설치 파일:** `apps/desktop/electron-builder.yml`, `pnpm --filter @metacode/desktop dist:win` (NSIS, 현재 사용자에 설치, 서명 없음), `dist:mac`(dmg+zip, arm64·x64), `dist:linux`(AppImage+deb, x64). 배포용은 자동 업데이트 항목의 워크플로가 만듭니다.
  - macOS는 Apple 개발자 서명 없이 임시 서명(`identity: '-'`)만 합니다. Apple Silicon은 서명이 아예 없으면 실행되지 않고, 서명 없이 hardened runtime을 켜면 JIT 권한이 없어 뜨지 않으므로 `hardenedRuntime: false`입니다. 받은 앱을 처음 열 때 "확인되지 않은 개발자" 경고가 뜹니다 (시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기).
  - deb는 `homepage`(package.json)와 `maintainer`가 있어야 만들어집니다. Linux 실행 파일 이름은 `metacode`, 창과 `.desktop`을 묶으려고 `desktopName`을 둡니다.
  - 설치한 앱은 운영 사이트(`https://metacode.kimyangmin.me`)를 앱 창에서 엽니다 (웹 빌드를 앱에 넣지 않음). 개발 중(`app.isPackaged`가 아님)에는 `localhost:5173`, 둘 다 `METACODE_WEB_URL`/`METACODE_API_URL`로 바꿀 수 있습니다. 앱 안에는 메인 프로세스와 preload만 들어갑니다.
  - 브리지 호출, 권한, 창 이동은 웹 주소와 **같은 출처**인지로 판단합니다 (`isAppUrl`). 다른 사이트로 이동하지 못하고, 외부 링크는 시스템 브라우저로 엽니다.
  - 설치한 앱은 이름(productName)이 MetaCode라 사용자 데이터가 `%APPDATA%\MetaCode`에 따로 생깁니다. 개발용 앱(`@metacode/desktop`)과 로그인, 한 번에 하나만 실행 잠금(`requestSingleInstanceLock`)이 섞이지 않습니다 (처음엔 이름이 같아서 개발용 앱이 켜져 있으면 설치한 앱이 바로 꺼졌음).
- **데스크톱 자동 업데이트:** `apps/desktop/src/main/updater.ts`(electron-updater), `.github/workflows/desktop-release.yml`, 웹 `features/desktop/UpdateNotice.tsx`
  - `desktop-v<버전>` 태그를 push하면 Actions가 Windows·macOS·Linux 러너에서 각각 설치 파일 + `.blockmap` + `latest*.yml`을 만들고, 모두 끝나면 GitHub Release(Latest) 하나로 올립니다 (한 OS라도 실패하면 올리지 않음). 태그와 `apps/desktop/package.json` 버전이 다르면 실패합니다. 저장소가 공개라서 앱에 토큰이 필요 없습니다.
  - 앱(설치한 것만)은 켤 때와 4시간마다 확인하고, 백그라운드에서 받아 두었다가 앱을 끌 때 설치합니다. 받으면 브리지 `updates`로 웹에 알려 화면 위에 "다시 시작"을 띄웁니다 (`quitAndInstall(true, true)`: 조용히 설치 후 다시 켬).
  - 앱은 저장소의 **Latest Release**를 보므로, 데스크톱이 아닌 Release를 Latest로 올리면 업데이트 확인이 깨집니다.
  - 스스로 설치하는 것은 Windows와 Linux AppImage뿐입니다. 서명하지 않은 macOS 앱(Squirrel.Mac은 서명을 확인함)과 deb로 설치한 Linux 앱(`APPIMAGE` 환경변수가 없음)은 `manual` 모드로 받지 않고 새 버전이 있다는 것만 알려(`update-available` → `UpdateReadyInfo.manual`) 웹이 "새 버전 받기"를 띄웁니다 (0.4.1부터).
  - 코드 서명을 하지 않아서 받은 설치 파일의 서명은 확인하지 않습니다. 서명을 도입하면 `electron-builder.yml`의 `win.publisherName`을 넣어 확인하게 합니다.
  - 0.2.0 이하 앱에는 `updates` 브리지가 없어서, 웹이 "새 버전 받기"(Releases 링크) 안내를 띄웁니다.
  - 업데이트 캐시 폴더 이름은 패키지 이름에서 나와 `@metacodedesktop-updater`입니다 (`%LOCALAPPDATA%` 아래).
- **역할과 채널 권한 (Phase 7):** `apps/server/src/chat/roles.service.ts`, `access.service.ts`, 웹 `features/communities/CommunitySettings.tsx`, `ChannelSettings.tsx`
  - 소유자와 관리자(`CommunityMember.role`)는 역할·채널을 관리하고 모든 채널을 봅니다. 관리자는 소유자만 정합니다. 사용자 정의 역할(`Role`)은 비공개 채널을 누구에게 보여 줄지 정하는 데 쓰고, 멤버 이름 색도 정합니다 (가장 위 역할의 색).
  - 채널이 보이는지는 `AccessService` 한 곳에서 판단합니다: 공개 채널은 멤버 전원, 비공개 채널은 관리자 + 허용된 역할을 가진 멤버. 목록 조회(`visibleChannelsWhere`), 접속할 때 들어가는 채널 방, 메시지·기록·첨부·통화(`getChannel`)가 모두 이 판단을 씁니다. 광장 말풍선도 채널 방으로 오는 `message:created`라서 그대로 따릅니다.
  - 권한이 바뀌면(역할 주기/빼기, 역할 지우기, 관리자 변경, 채널 설정, 비공개 채널 만들기) `RolesService.syncAccess`가 멤버마다 채널 방을 다시 맞추고, 볼 수 없게 된 음성 채널의 통화에서 빼고, `community:updated`로 알려 클라이언트가 커뮤니티 정보를 다시 받게 합니다.
  - 채널 삭제(마지막 텍스트 채널은 못 지움, 저장소 파일과 통화도 정리, `channel:deleted`), 멤버 내보내기(소유자는 못 내보냄, 관리자는 소유자만 내보냄, 나가기와 같은 처리), 역할·채널 순서 바꾸기(전체 목록을 새 순서로 보내고 같은 항목인지 확인)도 소유자·관리자만 합니다. 웹의 끌어서 순서 바꾸기는 `ui/useDragSort.ts`(HTML5 드래그, 파일 끌어 놓기와 구분하는 데이터 형식)입니다.
  - 테스트 주의: "이벤트가 오지 않는다"는 확인은 **보내기 전에** `expectNoEvent`를 걸어 둡니다. 보내기 확인(ack)을 기다린 뒤에 걸면 이미 도착한 이벤트를 놓쳐서 누수를 잡지 못합니다 (실제로 여러 테스트가 그랬고 고쳤음).
- **채팅 편의:**
  - 답장: `message:send`의 `replyToId`(같은 채널의 메시지만), DTO의 `replyTo`(앞 120자, 원래 메시지가 지워지면 null). 전달: `message:forward`(볼 수 있는 메시지를 쓸 수 있는 채널로, 보낸 사람은 전달한 사람, `forwarded: true`). 전달할 때 첨부는 저장소 파일까지 복사해서 원래 채널이 지워져도 남습니다.
  - 메시지 우클릭 메뉴(답장, 전달, 텍스트 복사, 링크 복사). 글을 골라 둔 상태면 브라우저 기본 메뉴를 씁니다.
  - 마크다운(`ui/markdownParser.ts` → `ui/Markdown.tsx`): Discord와 비슷한 범위. 블록은 ```코드 블록```, `>` 인용, `>>>` 끝까지 인용, `#`~`###` 제목, `-`/`*`/`1.` 목록, 나머지는 문단(줄바꿈 유지). 글자는 `**굵게**`, `*기울임*`/`_기울임_`(단어 속 `_`는 제외), `__밑줄__`, `~~취소선~~`, `||스포일러||`(누르면 보임), `` `코드` ``, `[글](https://…)`, `\`로 기호 그대로. 파서가 트리를 만들고 React 요소로 그리므로 HTML을 해석하지 않습니다.
  - 링크: http(s) 주소만 링크로 만듭니다 (`ui/links.ts`의 `splitLinks`, `[글](주소)`도 http(s)만. javascript: 주소는 글자로 남음). 새 창으로 열리고, 데스크톱은 setWindowOpenHandler가 시스템 브라우저로 엽니다.
  - 광장 말풍선과 답장 미리보기는 `markdownToPlain`으로 기호를 뺀 글을 씁니다 (스포일러는 `▒`로 가림).
  - GIF(`image/gif`, 15MB 이하)는 목록에서 썸네일(첫 장면만 담긴 WebP) 대신 원본을 틀어 움직이게 합니다. 더 크면 썸네일에 GIF 표시만 하고 크게 보기에서 움직입니다.
  - 목록을 맨 아래에서 400px 넘게 올리면 "맨 아래로" 버튼이 뜨고, 그 사이 온 메시지 수를 함께 보여 줍니다.
  - 여러 줄 메시지의 아바타는 위에 붙입니다 (`.message__gutter`의 `align-items: flex-start`, 예전엔 버튼이 줄 높이만큼 늘어나 가운데로 내려갔음).
  - 앱 화면의 글자는 고르거나 끌 수 없게(`user-select: none`) 하고, 메시지 내용·입력칸·정보 팝업만 고를 수 있습니다.
  - 채팅 영역 잡기(`features/chat/messageSelection.ts`, `MessageList`): Ctrl과 Shift를 **함께 눌렀다 떼면**(사이에 다른 키가 없을 때, `createModifierChord`) 화면 맨 아래에 보이는 메시지부터 잡기 시작합니다. 누르는 순간이 아니라 뗄 때 시작해서 Ctrl+Shift+Z 같은 단축키를 방해하지 않습니다. Shift+↑↓로 범위를 늘리고(↑↓만 누르면 한 칸 옮김), 잡기 중에는 메시지를 눌러 끌어서도 잡습니다. D = 범위 안의 **내** 메시지만 삭제(확인 창, 한 개씩 `message:delete`), C = "[시각] 이름: 내용" 기록 복사(날짜 줄 포함), F = 전달 창(여러 개면 오래된 것부터 차례로 `message:forward`), Esc = 끝. 글자 키는 한글 자판에서도 되도록 `e.code`(KeyD 등)로 봅니다. 시작할 때 입력창 포커스를 뺍니다.
  - 복사는 `ui/clipboard.ts`의 `copyText`(Clipboard API가 막히면 `execCommand('copy')`로 한 번 더)를 씁니다.
  - 사용자 정보 팝업(`stores/profile.ts`, `ProfilePopup`): 메시지·멤버 목록·통화 참여자의 아바타나 이름을 누르면 뜹니다. 멤버 목록은 예전처럼 바로 DM을 열지 않고 팝업의 "메시지 보내기"로 엽니다. 멤버 목록 보이기/숨기기(👥)는 localStorage에 기억합니다.
- **패널 배치와 분리:** `layout/SplitView.tsx`, `layout/arrangement.ts`, `stores/layout.ts`, `layout/Popout.tsx`
  - 머리글의 ⠿를 끌어 분할 영역의 가장자리(상하좌우 중 가장 가까운 쪽)에 놓으면 그쪽으로 옮깁니다. 배치(방향, 앞 패널)는 localStorage에 기억하고, 크기는 방향별로 기억합니다.
  - 창 밖에 놓거나(드래그 끝의 화면 좌표가 창 밖이고 아무 데도 놓지 않았을 때) ⧉를 누르면 `/popout/chat/:channelId`, `/popout/plaza/:plazaId`를 새 창으로 엽니다. 분리한 창은 앱 전체를 따로 띄워 실시간 연결을 따로 엽니다. 메인 창은 그 패널을 숨기고, 분리한 창이 닫히면(0.8초마다 확인) 다시 보여 줍니다. 브라우저가 드래그 끝의 팝업을 막으면 ⧉로 다시 시도하라고 안내합니다. 마지막 패널은 분리하지 않습니다.
  - 데스크톱: `setWindowOpenHandler`가 앱 출처의 `/popout/` 주소만 같은 보안 설정(preload, sandbox)의 앱 창으로 열고, 그 창에도 같은 규칙을 겁니다 (`main/windows.ts`). 다른 http(s) 주소는 시스템 브라우저로 엽니다.
  - **dragstart에서 화면을 바꾸지 않는다:** Chromium은 dragstart 직후 누른 자리에 끄는 요소가 그대로 있는지 확인하고, 다른 요소가 덮으면 드래그를 취소합니다. 처음에는 dragstart에서 놓을 자리 덮개를 그려서 실제 마우스로는 전혀 끌리지 않았습니다 (JS로 만든 DragEvent 확인으로는 못 잡음). 지금은 끄는 패널을 ref에만 두고, `.split-host`가 dragover/drop을 받으며, 미리보기는 `pointer-events: none`입니다.
  - **그리드 행 높이 고정:** `.app`은 `grid-template-rows: minmax(0, 1fr)`입니다. `.split-host` 래퍼를 넣었을 때 긴 채팅이 행을 늘려서 입력창이 화면 밖으로 밀리고 광장이 확대된 것처럼 보였습니다 (예전엔 react-resizable-panels의 Group이 `overflow: hidden`이라 드러나지 않았음).
- **커뮤니티 설정:** `apps/server/src/chat/community-profile.service.ts`, 웹 `features/communities/CommunitySettings.tsx`
  - 탭: 일반(이름, 아이콘, 배너, 커뮤니티 삭제), 광장(커뮤니티 타일·오브젝트, 광장 맵 편집), 역할, 멤버. 소유자·관리자만 열 수 있고, 삭제는 소유자만 커뮤니티 이름을 그대로 입력해야 합니다. 소유자의 커뮤니티 메뉴에는 나가기가 없습니다.
  - API: `PATCH /communities/:id {name}`, 아이콘·배너는 프로필 사진과 같은 흐름 `POST /communities/:id/images/:kind/upload` → 저장소에 PUT → `PUT /communities/:id/images/:kind`(매직 바이트 확인, 아이콘 256×256·배너 960×540으로 가운데를 채워 자른 WebP, `community-images/<id>/<종류>-<무작위>.webp`), `DELETE`로 지우기. 바뀌면 `community:updated`로 알립니다.
  - 이미지는 `GET /community-images/<id>/<file>`로 **인증 없이** 줍니다 (초대 화면은 아직 멤버가 아니고, 데스크톱 `<img>`는 토큰을 못 붙임. 주소에 무작위 ID). 1년 캐시(immutable). 커뮤니티를 지우면 이미지도 지웁니다.
  - 아이콘은 왼쪽 커뮤니티 목록과 초대 화면(`InviteInfo.communityIconUrl`), 배너는 채널 목록 위(16:9)에 보입니다.
- **친구:** `apps/server/src/friends/`, 웹 `features/friends/`
  - `Friendship`(requesterId, addresseeId, status `PENDING`|`ACCEPTED`): 두 사람 사이에 줄 하나. 사용자 ID(username)로 요청하고, 상대의 요청이 이미 와 있으면 요청만으로 친구가 됩니다. 거절·취소·끊기는 줄을 지웁니다.
  - API: `GET /friends`(friends/incoming/outgoing + 온라인 여부), `POST /friends/requests {username}`, `POST /friends/requests/:userId/accept`, `DELETE /friends/:userId`(거절·취소·끊기). 바뀔 때마다 두 사람의 `user:` 방에 `friend:updated {userId, status}`(상대 기준 관계)를 보내고 웹은 친구 목록을 다시 받습니다.
  - 친구끼리는 커뮤니티·DM이 겹치지 않아도 온라인 상태(`presenceAudience`)와 프로필 변경(`user:updated`, 요청 중 포함)을 받습니다.
  - 화면: DM 홈(대화를 고르지 않았을 때)이 친구 화면(온라인 · 모두 · 대기 중 · 친구 추가), DM 목록 위 "친구"와 왼쪽 DM 아이콘에 받은 요청 표시, 사용자 정보 팝업의 친구 버튼(추가/취소/수락/끊기), 새 대화 창에 친구 목록(검색하지 않아도 체크해서 그룹 대화).
- **프로필 (닉네임, 자기소개, 사진):** `apps/server/src/users/`
  - 사용자 ID는 GitHub 로그인 이름(`username`)이고 바꿀 수 없습니다. 다른 사람에게 보이는 이름은 `nickname`(없으면 username), 자기소개는 `bio`입니다. DTO의 `displayName`은 닉네임입니다 (GitHub 이름은 DB의 `displayName`에 남지만 화면에는 쓰지 않음).
  - GitHub로 다시 로그인하면 username, GitHub 이름, GitHub 사진만 맞추고 닉네임·자기소개·올린 사진은 건드리지 않습니다.
  - 프로필 사진: `POST /users/me/avatar/upload`(크기를 서명에 넣은 presigned PUT, 원본은 `avatar-uploads/<userId>` 한 칸) → 브라우저가 PUT → `PUT /users/me/avatar`(매직 바이트 확인, 256px 정사각형 WebP로 바꿔 `avatars/<userId>/<무작위>.webp`에 저장, 원본과 이전 사진 삭제). `DELETE /users/me/avatar`면 GitHub 사진으로 돌아갑니다.
  - 사진은 `GET /avatars/<userId>/<file>`로 **인증 없이** 줍니다 (데스크톱 `<img>`는 토큰을 못 붙이고, 주소에 무작위 ID가 있어 추측할 수 없음). 바꾸면 주소가 바뀌므로 1년 캐시(immutable)합니다. 주소는 `PUBLIC_SERVER_URL` 기준입니다.
  - 닉네임이나 사진이 바뀌면 `user:updated`(UserProfile)를 본인, 속한 커뮤니티, DM 방에 보냅니다.
- **설정 창과 음성 버튼:** `features/settings/SettingsDialog.tsx`, `stores/settings.ts`, `features/voice/VoicePanel.tsx`, `features/voice/devices.tsx`
  - 사이드바 아래 ⚙가 설정 창을 엽니다 (화면의 80%, 바깥은 어둡게, 바깥을 누르거나 Esc면 닫힘). 왼쪽 목록: 내 계정(사진, 사용자 ID, 닉네임, 자기소개), 음성(장치, 마이크 증폭, 출력 음량), 맨 아래 로그아웃. 로그아웃 버튼은 여기로 옮겼습니다.
  - 음성 패널의 버튼은 마이크, 헤드셋, 화면 세 개입니다 (나가기 ✕는 머리글). 마이크·헤드셋은 우클릭하거나 옆의 ˄를 누르면 버튼 위에 팝업이 뜹니다: 마이크 = 입력 장치·증폭, 헤드셋 = 출력 장치·음량·근접 음성. 팝업의 "음성 설정 열기"는 설정 창의 음성 항목으로 갑니다.
  - 출력 음량(0~100%)은 참여자별 음량(`trackVolume`)에 곱합니다. LiveKit의 `setVolume`은 WebAudio를 쓰지 않으면 1을 넘길 수 없어 100%까지입니다.
  - 마이크 증폭(0~200%)은 LiveKit 오디오 처리기(`micGain.ts`, WebAudio GainNode)로 올리기 전에 바꿉니다. 100%면 처리기를 붙이지 않습니다. 장치·증폭·음량은 localStorage에 기억합니다.
  - 닉네임·사진이 바뀌면(`user:updated`) `realtime/userUpdates.ts`의 `withUserProfile`로 모든 쿼리 캐시와 통화 목록, 정보 팝업의 사용자 정보를 바꾸고, 광장은 이름표를 고칩니다. 자기소개는 메시지·멤버 목록에 싣지 않고 정보 팝업을 열 때 `GET /users/:id`로 받습니다.
- **데스크톱 로그인 유지:** 앱을 켤 때 네트워크가 아직 없거나 서버가 잠깐 응답하지 않으면, 예전에는 메인 프로세스가 토큰은 남긴 채 렌더러에 null을 줘서 로그인 화면이 떴습니다 (로그아웃처럼 보임). 지금은 1초, 2초 뒤 두 번 더 시도하고, 그래도 안 되면 `SessionUnavailableError`로 거절합니다 (토큰 유지). 웹은 이것을 "서버에 연결하지 못했습니다 + 다시 시도"로 보여 주고, `me` 조회도 401이 아니면 몇 번 더 시도합니다. 401(세션 끊김)일 때만 로그인 화면입니다. 이 변경은 데스크톱 0.3.1부터입니다.
- **에셋 형식 (Phase 6):** `packages/shared/src/assets/`
  - 에셋 = JSON 하나(`AssetManifest`): kind(`tile`|`object`|`character`), 크기, 팔레트(최대 64색, `#rrggbb`), 프레임(팔레트 인덱스 바이트를 base64로, 0 = 투명, v = palette[v-1]), 애니메이션(프레임 번호 + frameMs). PNG 대신 이 형식이라 DB에 그대로 넣고 서버가 zod로 검증합니다 (캐릭터 한 벌 약 20KB).
  - 타일 16×16(`solid`면 못 지나감), 오브젝트는 16px 단위 최대 64×64(`footprint` = 그림을 덮는 타일 격자 중 막힌 칸, 놓는 기준은 그림의 왼쪽 아래 칸). 타일·오브젝트는 애니메이션 `default` 하나를 씁니다.
  - 캐릭터 해상도는 **가로 16~128px, 세로는 가로의 2배**입니다 (`isCharacterSize`, 기본 16×32). 하나로 고정하지 않는 이유는 받아 온 에셋(32×64, 48×96 등)을 줄이지 않고 그대로 쓰기 위해서입니다. 광장에서 차지하는 크기는 해상도와 상관없이 늘 `CHARACTER_WORLD_WIDTH`×`CHARACTER_WORLD_HEIGHT`(16×32 = 1타일×2타일)이므로, 충돌·이동 검증·카메라·이름표 위치는 해상도와 무관합니다. 그리는 쪽에서 `fitCharacter`가 `setDisplaySize`로 줄입니다 (텍스처를 바꾼 뒤에도 다시 불러야 함).
  - 해상도를 푼 대신 `ASSET_PIXEL_BUDGET`(128×256 × 32프레임 = 1,048,576픽셀)으로 에셋 하나의 총량을 막습니다. 매니페스트를 그대로 DB에 넣고 광장에서 내려받기 때문입니다. 서버 요청 본문 한도도 express 기본 100KB로는 모자라 `app.setup.ts`에서 2MB로 올렸습니다.
  - 캐릭터 필수 애니메이션은 `REQUIRED_CHARACTER_ANIMATIONS`(대기 1프레임 이상, 걷기 2프레임 이상, 첨부 모션 `emote` 2프레임 이상, 빈 프레임 불가). 에디터와 서버가 같은 `missingAnimations`를 씁니다.
  - 색 부위(`colorSlots`): skin/hair/shirt/pants/shoes마다 [밝은 면, 그림자, 외곽선] 픽셀 값. 고른 색 하나를 `colorRamp`로 세 색으로 만들어 바꿉니다. 같은 색이 두 부위에 있으면 함께 바뀌므로 내장 캐릭터의 기본 색은 서로 다르게 둡니다 (빌드 스크립트가 확인).
  - 맵 = `MapDefinition`: 크기(12~64타일), 타일 목록 + 바닥·장식 두 층 격자(base64, 값 v = tiles[v-1]), 오브젝트 목록, 스폰 영역. `buildCollision`이 막힌 칸을 계산합니다.
  - 에셋 참조: `builtin:<이름>` 또는 직접 만든 에셋의 uuid. 내장 에셋(약 150KB)은 `@metacode/shared/builtin-assets`로 따로 불러옵니다 (기본 export에 넣지 않음).
  - 내장 에셋 JSON(`packages/shared/src/assets/builtin/assets.json`)은 빌드 스크립트가 만들고 커밋합니다. Prettier는 이 파일을 건너뜁니다. 기본 캐릭터는 base sprites(18×36, 그림 14×34)에서 프레임마다 머리의 겹치는 줄(맨 위+4)과 다리 줄(맨 아래-6)을 빼서 16×32에 맞추고, 몸의 세 음영(밝은 면·그림자·외곽선)을 부위별 색으로 바꿔 칠합니다.
- **에셋 저장과 도트 에디터 (Phase 6):** `apps/server/src/assets/`, 웹 `features/assets/`
  - `Asset` 테이블: kind, name, creatorId, communityId(캐릭터는 null), manifest(JSON). S3를 쓰지 않고 매니페스트를 그대로 저장합니다 (가장 큰 오브젝트도 요청 본문 100KB 안).
  - 권한(`AssetsService`): 캐릭터는 만든 사람만 고치고 지우며 로그인한 누구나 읽습니다(광장에서 그려야 하므로). 타일·오브젝트는 멤버만 읽고 소유자·관리자(`requireManager`)만 만들고 고칩니다. 멤버가 아니면 404. 종류는 바꿀 수 없고, 캐릭터는 한 사람 20개, 커뮤니티 에셋은 200개까지.
  - API: `GET /assets`(내 캐릭터), `GET /assets?communityId=`(커뮤니티 타일·오브젝트), `GET/PUT/DELETE /assets/:id`, `POST /assets {communityId?, manifest}`.
  - 설정 → 에셋(`AssetSettings`, 지연 로딩): 내 캐릭터. 커뮤니티 타일·오브젝트와 광장 맵 편집은 커뮤니티 설정 → 광장(`CommunityPlazaAssets`)에 있습니다. 새로 그리기, 내장 에셋 복제해서 시작, 편집, 삭제.
  - 도트 에디터(`PixelEditor`, 편집 로직은 `editorModel.ts`의 `PixelDocument`): 연필·지우개·채우기·스포이트·올가미·자르기, 좌우 대칭, 앞 프레임 겹쳐 보기, 되돌리기(붓질 한 번 = 한 단계, 색 고르기 드래그도 한 단계), 팔레트 편집(지운 색의 픽셀은 투명), 프레임 넣기·복제·옮기기·지우기, 애니메이션 미리보기, PNG 가져오기(프레임 크기 또는 가로로 이어 붙인 시트, 64색이 넘으면 가까운 색)·내보내기. 오른쪽 버튼은 지우개.
  - 선택·자르기(`selection.ts`): 올가미는 그린 다각형 안(픽셀 가운데 기준)을 고르고, 고른 곳을 끌거나 방향키로 옮깁니다. 옮기는 동안은 떠 있는 상태(`lifted`: 아래 그림 `base` + 얹은 값)라 지나간 자리의 그림이 지워지지 않습니다. 선택은 고른 프레임에서 다른 편집이 없을 때만(`version`이 같을 때) 살아 있고, 복사한 조각은 같은 자리에 붙습니다 (다른 프레임·애니메이션에 붙여 맞추기 쉽게). 자르기는 사각형 밖을 지우고(이 프레임 또는 모든 프레임), "그림 크기도 맞추기"면 캐릭터는 가로 = max(사각형 가로, 세로/2)로 발밑 가운데, 오브젝트는 16px 단위로 왼쪽 아래에 둡니다.
  - 발 아래 정리(`trimBelowFeet`): 광장은 그림 맨 아래를 발밑으로 세우므로, **애니메이션마다** 그 안의 프레임에 공통으로 빈 아래 줄만큼 캐릭터 그림을 내립니다 (한 애니메이션 안의 걷기 들썩임은 유지, 빈 프레임은 세지 않음). 처음엔 모든 프레임의 최솟값을 써서, 내장 캐릭터처럼 걷기에 바닥에 닿은 프레임이 하나라도 있으면 대기·첨부 모션도 정리되지 않았습니다. 캐릭터를 저장할 때 자동으로 하고 에디터에서 끌 수 있습니다 (localStorage).
  - 에디터에서는 애니메이션마다 프레임을 따로 갖고, 저장할 때 같은 그림을 한 장으로 합칩니다 (`toManifest`). 캐릭터는 `missingAnimations`가 비어야 저장 버튼이 켜집니다.
  - 도트 에디터·맵 에디터는 앱에 하나만 둔 `AssetEditors`가 화면 전체로 띄웁니다 (설정 창과 커뮤니티 설정 어디서 열어도 그 위에 뜸). Esc는 에디터가 먼저 받아 `preventDefault()`하고, 설정 창과 `Dialog`는 `defaultPrevented`면 닫지 않습니다. 에디터를 연 창을 닫으면 에디터도 닫습니다 (`closeAssetEditors`).
- **캐릭터 고르기 (Phase 6):** `UsersService.setCharacter`, 웹 `features/assets/CharacterSettings.tsx`
  - `User.character`(JSON `{asset, colors, version?}`), null이면 `defaultCharacter(userId)`. 프로필(`UserProfile.character`)에 실려 메시지·멤버·광장 인원 어디서나 같은 값을 씁니다.
  - `PUT /users/me/character {character | null}`: 기본 캐릭터(`BUILTIN_CHARACTERS`)나 **직접 만든** 캐릭터만 고를 수 있습니다 (남의 캐릭터 400). 색은 부위(`colorSlots`)가 있는 캐릭터에만 적용됩니다 (내장 캐릭터를 복제해 그린 것도 부위가 남음).
  - 직접 그린 캐릭터는 `version`(에셋 updatedAt)을 함께 저장합니다. 그 에셋을 고치면 version을 올리고, 지우면 기본 캐릭터로 돌려서 `user:updated`로 알립니다 (`characterAssetChanged`). 광장은 `['assets','one',id,version]`으로 에셋을 받아(`PlazaView.loadCharacters`) 씬에 등록한 뒤 다시 그리고, 받기 전에는 기본 캐릭터로 보입니다. 텍스처 키는 version이 아니라 **실제로 그린 매니페스트 객체**(`manifestId`, 맵 타일·오브젝트와 같은 방식)로 만듭니다. `user:updated`가 먼저 와서 새 에셋을 받기 전에 다시 그리므로, version으로 키를 만들면 새 버전 키에 예전 그림이 들어가 받은 뒤에도 바뀌지 않았습니다 (실제로 겪은 문제).
  - `withUserProfile`은 닉네임·사진과 함께 캐릭터도 바꿉니다.
- **맵 에디터 (Phase 6):** `apps/server/src/plaza/plaza-maps.service.ts`, `maps.controller.ts`, 웹 `features/assets/MapEditor.tsx`, `mapModel.ts`
  - `CommunityMap`(communityId, definition JSON). 없으면 내장 분수 광장. DM 모닥불 캠프는 늘 내장 맵입니다.
  - API: `GET /communities/:id/map`(멤버), `PUT`(소유자·관리자, `{definition}`), `DELETE`(내장 맵으로 되돌리기). 저장할 때 zod 검증 + 쓰는 에셋이 내장 에셋이거나 **이 커뮤니티의** 타일·오브젝트인지(`mapAssetProblems`) + 스폰 영역에 설 칸이 있는지(`hasStandableSpawn`) 확인합니다.
  - 서버는 커뮤니티마다 맵(정의, 충돌 격자, 쓴 커뮤니티 에셋과 버전)을 메모리에 캐시합니다 (`PlazaMapsService.load`, 이동 검증이 자주 읽음). 서버 한 대 전제라 여러 대로 늘리면 캐시 무효화를 Redis pub/sub 등으로 나눠야 합니다.
  - 맵을 저장·되돌리거나, 맵에 쓴 커뮤니티 에셋을 고치면: 캐시를 버리고 그 광장의 위치(`plaza:pos:<plazaId>`)를 지운 뒤 `plaza:mapChanged`를 `community:<id>` 방에 보냅니다. 광장을 보던 클라이언트는 다시 `plaza:watch`하고 모두 스폰 영역에서 다시 시작합니다 (막힌 칸이 바뀌었을 수 있으므로).
  - 맵에 쓰고 있는 에셋은 지울 수 없습니다 (409).
  - 스냅샷의 `assets`(쓴 커뮤니티 에셋 `{id, version}`)를 클라이언트가 `['assets','one',id,version]`으로 받아 씬에 등록한 뒤 맵을 그립니다. 텍스처 키는 매니페스트마다 달라서 고친 에셋이 바로 반영됩니다.
  - 맵 에디터: 바닥 칠하기, 장식 칠하기, 바닥 채우기, 오브젝트 놓기(누른 칸 = 그림의 왼쪽 아래), 지우기(앞에 그려지는 오브젝트부터, 없으면 장식), 스폰 영역(끌어서), 막힌 칸 보기, 크기(12~64, 왼쪽 위 기준), 되돌리기. 팔레트는 내장 타일·오브젝트 + 커뮤니티 에셋(★). 열 때마다 맵을 새로 받습니다 (예전에 받아 둔 맵으로 시작해 다른 사람이 고친 것을 덮어쓰지 않게, 실제로 겪은 문제). 저장할 때 쓰지 않는 타일은 목록에서 뺍니다.
- **프로필 사진 불러오기 실패:** `ui/Avatar.tsx`는 사진을 못 불러오면(연결이 불안정할 때) 깨진 그림 대신 이름 첫 글자를 보여 주고, 2초·5초·15초·60초 뒤와 `online` 이벤트 때 주소에 `retry=N`을 붙여 다시 불러옵니다 (같은 주소면 `<img>`가 다시 요청하지 않음).
- **웹 새 배포 자동 반영:** 빌드마다 `__BUILD_ID__`를 앱에 넣고 같은 값을 `version.json`으로 내보냅니다 (`vite.config.ts`). 앱(`features/app/liveUpdate.ts`)은 1분마다와 창이 다시 보일 때 `version.json`을 보고, 바뀌었으면 잃을 것이 없을 때(통화 중이 아님, 에셋·맵 에디터를 열지 않음, 입력칸에 쓰던 글이 없음) `location.reload()`합니다. 기다리는 동안은 "새 버전" 안내를 띄웁니다. Caddy는 `/assets/*` 밖(index.html, version.json)에 `Cache-Control: no-cache`를 붙여, 예전처럼 데스크톱 앱이 캐시된 옛 index.html을 여는 일을 막습니다. 개발 서버에서는 동작하지 않습니다.
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
| 첨부 표시 | 메타버스 모드에서 말풍선 대신 캐릭터 모션(`emote`). 머리 위에는 무엇을 몇 개 올렸는지만 작게 표시 |
| 파일 크기 제한 | 기본 50MB |
| 도트 에셋 크기 | 타일 16×16px. 캐릭터 한 프레임은 가로 16~128px·세로는 가로의 2배(기본 16×32px)이고, 해상도와 상관없이 광장에서는 늘 1타일×2타일을 차지함 (2026-09-28: 받아 온 에셋을 줄이지 않고 쓰려고 고정 16×32에서 범위로 바꿈) |
| 테마 | 계절·행사에 따라 테마를 바꿀 수 있어야 함. 기능은 추후에 만들지만, 맵·에셋 구조는 처음부터 테마 교체를 전제로 만듦 |
| 진행 순서 | Phase 7을 먼저 진행하다가 2026-09-28 Phase 6 시작 |
| 기본 에셋 | CC0 에셋팩: 타일은 Kenney Tiny Town, 캐릭터 몸은 OpenGameArt의 16x16 base sprites. 분수·모닥불처럼 없는 것은 같은 팔레트로 직접 그림 (2026-09-28) |
| 에셋 제작 | 앱 안의 도트 에디터(설정 → 에셋 목록)로 타일·오브젝트·캐릭터를 그림. 캐릭터는 필수 애니메이션(대기·걷기 4방향, 첨부 모션)을 다 그려야 저장 (2026-09-28) |
| 에셋 범위 | 캐릭터는 개인 것(만든 사람이 씀). 타일·오브젝트는 커뮤니티 것(소유자·관리자가 만들고 그 커뮤니티 광장에 씀). 내장 에셋은 모두가 씀 (2026-09-28) |
| 맵 편집 | 커뮤니티 소유자·관리자가 맵 에디터로 분수 광장에 타일·오브젝트를 배치. 커뮤니티마다 맵이 다름. DM 모닥불 캠프는 내장 맵만 씀 (2026-09-28) |
| 데스크톱 코드 서명 | 당분간 하지 않음 (테스트 단계). 설치 때 "Windows의 PC 보호" 경고는 추가 정보 → 실행으로 넘김. 정식 공개 때 다시 정함 (2026-09-27) |
| 모니터링 | 셀프 호스팅 (같은 서버에 Uptime Kuma). 외부 서비스는 쓰지 않음 (2026-09-27) |
| 채널 권한 | Discord식 사용자 정의 역할. 역할을 만들고 채널마다 역할별로 허용 (2026-09-27) |

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
   - 분수 광장과 모닥불 캠프는 코드 분기가 아니라 맵 정의(`MapDefinition`)로 구분합니다. 서버의 이동 검증과 클라이언트 렌더링이 같은 맵 정의를 읽습니다. 충돌은 맵 정의에서 계산합니다 (타일의 `solid`, 오브젝트의 `footprint`).
   - 맵 에디터로 커뮤니티마다 배치가 달라질 수 있습니다. 그래도 서버와 클라이언트가 같은 맵 정의를 읽는다는 원칙은 같습니다.
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
    - 음성 채널에 들어가도 캐릭터는 커뮤니티 광장에 그대로 있습니다. 광장의 캐릭터에는 참여 중인 음성 채널과 말하는 중 이펙트를 표시합니다. 참여 중인 채널은 광장을 보는 모든 사람에게 보이고, **말하는 중은 같은 통화에 들어가 있는 사람에게만** 보입니다 (채팅 모드 참여자 목록도 같음, 2026-09-28).
    - 근접 음성은 통화마다의 설정입니다 (`Channel.proximityVoice`). 그 통화 참여자 누구나 바꿀 수 있고, 바뀌면 참여자 전원에게 알립니다.
    - ON이면 같은 통화 참여자끼리만, 서버가 가진 광장 위치로 거리를 계산합니다. 반경 밖 참여자의 오디오 트랙은 구독하지 않고(실제로 안 들리고 대역폭도 아낌), 반경 안에서는 거리에 따라 볼륨을 줄입니다.
    - 다른 통화 참여자의 음성은 거리와 상관없이 절대 섞이지 않습니다.
11. **캐릭터·맵 에셋은 교체 가능해야 한다.** 렌더링 코드는 특정 이미지에 의존하지 않고 에셋 매니페스트(크기, 팔레트, 프레임, 애니메이션 이름)만 읽습니다. 내장 에셋과 도트 에디터로 그린 에셋이 같은 형식이라 같은 코드로 그립니다. 캐릭터 애니메이션은 이름(`idle-<방향>`, `walk-<방향>`, 첨부 모션 `emote`)으로 참조합니다.
12. **이벤트 규격은 `packages/shared`에만 정의한다.** 소켓 이벤트 이름, 페이로드 타입, zod 스키마는 공용 패키지에 두고 클라이언트와 서버가 import합니다. 서버는 들어오는 모든 페이로드를 zod로 검증합니다.
13. **웹 코드는 Electron을 모른다.**
    - `apps/web`은 `electron`을 import하지 않습니다. 데스크톱 전용 기능(로그인, 네이티브 알림, 트레이, 자동 업데이트)은 preload가 노출하는 브리지(`window.metacode`)를 통해서만 쓰고, 브리지 타입은 `packages/shared`에 둡니다.
    - 브리지가 없으면(브라우저) 웹 대체 동작으로 돌아가야 합니다.
    - Electron 보안 설정: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. 원격 콘텐츠에 Node 권한을 주지 않습니다.

## 실시간 이벤트 규칙

- 이름은 `도메인:동작` 형식입니다. 도메인: `message`, `channel`, `plaza`, `presence`, `voice`, `typing`, `user`, `friend`
- 클라이언트 → 서버는 명령형, 서버 → 클라이언트는 과거형으로 짓습니다.
  - `message:send` → `message:created`, `message:edit` → `message:updated`, `message:delete` → `message:deleted` (내 메시지만)
  - `typing:start` → `typing:started` (보낸 연결 제외)
  - 닉네임·프로필 사진·캐릭터 변경 → `user:updated`
  - 친구 요청·수락·거절·취소·끊기 → `friend:updated` (두 사람의 `user:` 방)
  - `channel:created`, `dm:created`, `community:member-joined` / `member-left` / `deleted`, `presence:changed`
  - `plaza:watch` / `plaza:unwatch`: 광장 화면을 열고 닫을 때 (위치 업데이트 구독)
  - `plaza:move` → `plaza:moved`
  - 광장 인원 변화 → `plaza:member` (나타남/사라짐 한 명씩), 되돌림 → `plaza:corrected`
  - 커뮤니티 광장의 맵(또는 맵에 쓴 에셋)이 바뀜 → `plaza:mapChanged` (다시 `plaza:watch`)
  - `voice:sync`(ack로 볼 수 있는 통화 전부), `voice:join`(ack로 음성 서버 주소와 입장권) / `voice:leave` → `voice:joined` / `voice:left`
  - `voice:update`(내 음소거, 헤드셋, 말하는 중) → `voice:updated`
  - `voice:setProximity` → `voice:proximityChanged`, 근접 음성 음량 → `voice:gains` (받는 사람마다 다름, `user:` 방으로)
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

- `User` (구현됨): githubId, username(사용자 ID), displayName(GitHub 이름), avatarUrl(GitHub 사진), nickname, bio, avatarKey(올린 사진), character(광장 캐릭터 `{asset, colors, version?}`, null이면 기본)
- `RefreshToken` (구현됨): userId, tokenHash, familyId, client, expiresAt, revokedAt
- `Friendship` (구현됨): requesterId, addresseeId(둘이 기본 키), status(`PENDING` | `ACCEPTED`), createdAt, acceptedAt
- `Community` (구현됨): name, ownerId, iconKey·bannerKey(올린 아이콘·배너, 없으면 null) / `CommunityMember`: userId, communityId, role(`OWNER` | `ADMIN` | `MEMBER`) / `Invite`: code(8자), expiresAt(7일), uses
- `Role` (구현됨): communityId, name(커뮤니티 안에서 고유), color(#rrggbb), position / `MemberRole`: 멤버 ↔ 역할 / `ChannelRoleAccess`: 비공개 채널 ↔ 볼 수 있는 역할
- `Channel` (구현됨): type(`TEXT` | `VOICE` | `DM` | `GROUP_DM`), communityId(DM이면 null), name, position, proximityVoice, private(비공개 채널), dmKey(1:1 DM 중복 방지)
  - `ChannelMember`: DM 참여자. 커뮤니티 채널의 접근은 커뮤니티 멤버십(추후 채널 권한)으로 판단
  - 광장은 테이블이 아닙니다. 채널에서 계산합니다: `TEXT`·`VOICE` → `community:<communityId>`(분수 광장), `DM`·`GROUP_DM` → `dm:<channelId>`(모닥불 캠프)
- `Message` (구현됨): channelId, authorId, content(최대 4000자), createdAt, editedAt(고친 시각). id가 UUIDv7이라 id 순서 = 시간 순서
- `ChannelReadState` (구현됨): channelId, userId, lastReadMessageId. 앞으로만 옮긴다
- `Attachment` (구현됨): channelId(권한 판단), uploaderId, messageId(보내기 전 null), status(`PENDING` | `READY`), kind(`IMAGE` | `FILE`), objectKey, thumbnailKey, fileName, contentType, size, width, height
- `Asset` (구현됨): kind(`TILE` | `OBJECT` | `CHARACTER`), name, creatorId, communityId(캐릭터는 null), manifest(에셋 매니페스트 JSON)
- `CommunityMap` (구현됨): communityId, definition(맵 정의 JSON). 없으면 내장 분수 광장

## 도트 에셋 규격

크기는 확정, 나머지는 Phase 4~6에서 이 기준으로 구현합니다.

- **크기 (확정):** 타일 16×16px. 캐릭터 한 프레임의 해상도는 가로 16~128px, 세로는 가로의 2배(기본 16×32px)이고, 광장에서 차지하는 크기는 늘 16×32px(가로 1타일, 세로 2타일)입니다. 도트 에디터의 "해상도"에서 직접 고칩니다 (그림은 발밑 가운데를 기준으로 남음).
- **확대:** 화면에는 정수배로만 확대합니다 (기본 3배, 사용자가 2~4배 선택 — 선택 UI는 아직 없음). Phaser는 `pixelArt: true`, `roundPixels: true`로 설정하고, 패널 크기가 바뀌면 정수 배율을 다시 계산합니다. 2.5배 같은 소수 배율은 쓰지 않습니다.
- **카메라:** 모닥불 캠프(약 16×12타일)는 맵 전체가 패널에 들어오는 가장 큰 정수 배율로 보여주고, 분수 광장(약 48×36타일 이상)은 배율을 고정하고 카메라가 내 캐릭터를 따라갑니다.
- **캐릭터 기준점:** 발밑 가운데입니다. 충돌 판정은 발 영역(약 10×6px)만 쓰고, y좌표 순서로 앞뒤를 그려서 분수나 모닥불 뒤로 지나갈 때 가려지게 합니다.
- **스프라이트시트 배치:** 행은 방향(아래, 왼쪽, 오른쪽, 위), 열은 프레임입니다. 커스터마이징 부품(몸, 머리카락, 옷)은 같은 배치로 따로 그려서 실행 중에 겹칩니다.
- **글자:** 말풍선과 이름표의 글자는 도트 배율로 키우지 않습니다. 화면 해상도로 렌더링하거나 한글 도트 폰트(Galmuri 등 오픈 라이선스)를 씁니다. 말풍선 틀은 도트로 그려도 됩니다.
- **제작 도구:** 앱 안의 도트 에디터(PNG 가져오기·내보내기)와 맵 에디터. 기본 에셋은 `pnpm assets:build`(`tools/build-assets.mjs`)가 `assets/vendor`의 CC0 원본과 `tools/assets`의 그리는 코드로 만듭니다.
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
packages/shared/src/assets/  # 에셋·맵 형식, 내장 에셋 JSON (builtin/)
assets/
  vendor/               # CC0 원본 PNG
  CREDITS.md            # 출처
tools/
  build-assets.mjs      # 내장 에셋 만들기
  assets/               # 직접 그리는 오브젝트, 캐릭터 옷 입히기
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
| `pnpm assets:build` | 내장 에셋 다시 만들기 (`--preview <폴더>`로 확대 PNG) |
| `pnpm --filter @metacode/server db:migrate` | 스키마 변경 → 마이그레이션 생성 + 로컬 DB 적용 (`--name <이름>`) |
| `pnpm --filter @metacode/server db:deploy` | 만들어 둔 마이그레이션만 적용 (운영, CI) |

작업을 마치기 전에 `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`가 통과하는지 확인합니다 (CI와 같은 순서).

## 미결정 사항

사용자와 정해야 하는 항목입니다. 정해지면 이 목록에서 지우고 "확정된 결정"에 옮깁니다.

테마 기능을 만들기 전까지 정하면 됩니다.

- 테마 적용 주체: 운영자가 전체에 일괄 적용(기간 예약)하는지, 커뮤니티 관리자가 고르는지, 둘 다인지
- 테마 범위: 광장 맵만인지, 캐릭터 소품(모자 등)까지인지, 채팅 UI까지인지
