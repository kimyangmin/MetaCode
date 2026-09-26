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

- **Phase 0 (프로젝트 기반) 완료.** 다음은 Phase 1 (인증과 사용자)입니다. CI는 원격에 올린 뒤 첫 실행을 확인해야 합니다.
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
- **운영 구성 원칙 (Phase 1 끝에 만듦):** `infra/docker-compose.prod.yml` + `.env.production.example` + Caddy(HTTPS 자동 발급)로 따로 만듭니다.
  - 외부에는 Caddy의 80/443만 엽니다. 앱, DB, Redis, SeaweedFS는 내부 네트워크에만 둡니다.
  - SeaweedFS는 presigned 업로드를 위해 Caddy를 거쳐 HTTPS 서브도메인으로 공개하고 CORS를 설정합니다.
  - 비밀값은 전부 `.env`로 받고 저장소에 두지 않습니다 (개발용 `infra/seaweedfs/s3.json` 같은 고정 계정을 운영에 쓰지 않음).
  - 이미지 태그는 버전을 고정하고, 컨테이너에 `restart: unless-stopped`를 겁니다. PostgreSQL과 SeaweedFS 볼륨을 백업합니다.
- **Oracle Cloud 주의점:**
  - 포트를 열려면 VCN의 Security List(또는 NSG)와 서버 안의 iptables(`/etc/iptables/rules.v4`, Oracle Ubuntu 이미지는 기본으로 막혀 있음)를 **둘 다** 열어야 합니다.
  - 무료 티어 Ampere 서버는 ARM64(aarch64)이므로, 쓰는 이미지가 arm64를 지원하는지 확인합니다.
  - LiveKit(Phase 5)은 UDP 포트 범위도 열어야 합니다.
- **Windows에서 파일 수정:** Windows PowerShell 5.1의 `Get-Content`/`Set-Content`는 UTF-8 한글을 깨뜨립니다. 파일 수정은 편집 도구나 bash를 씁니다.

## 확정된 결정

2026-09-26 사용자와 정한 내용입니다.

| 항목 | 결정 |
| --- | --- |
| 배포 형태 | 웹 + 데스크톱 앱 둘 다 |
| 운영 서버 | Oracle Cloud의 Ubuntu 서버 한 대, 도메인 있음. 이 저장소를 서버에 클론해서 Docker Compose로 운영. 운영용 구성은 개발용과 따로 둠 (Phase 1 끝에 만듦) |
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
    - `apps/web`은 `electron`을 import하지 않습니다. 데스크톱 전용 기능(딥링크, 네이티브 알림, 트레이, 자동 업데이트)은 preload가 노출하는 브리지(`window.metacode`)를 통해서만 쓰고, 브리지 타입은 `packages/shared`에 둡니다.
    - 브리지가 없으면(브라우저) 웹 대체 동작으로 돌아가야 합니다.
    - Electron 보안 설정: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. 원격 콘텐츠에 Node 권한을 주지 않습니다.

## 실시간 이벤트 규칙

- 이름은 `도메인:동작` 형식입니다. 도메인: `message`, `channel`, `plaza`, `presence`, `voice`, `typing`
- 클라이언트 → 서버는 명령형, 서버 → 클라이언트는 과거형으로 짓습니다.
  - `message:send` → `message:created`
  - `plaza:watch` / `plaza:unwatch`: 광장 화면을 열고 닫을 때 (위치 업데이트 구독)
  - `plaza:move` → `plaza:moved`
  - 광장 인원 변화 → `plaza:roster`
  - `voice:join` / `voice:leave` → `voice:joined` / `voice:left`
  - `voice:setProximity` → `voice:proximityChanged`
- Socket.IO room 이름은 `channel:<channelId>`, `plaza:<plazaId>` 형식을 씁니다.

## 인증 흐름

- 웹: GitHub OAuth → 서버 콜백 → HttpOnly 쿠키로 세션 발급.
- 데스크톱: 앱이 시스템 브라우저로 GitHub 인증 페이지를 엶 → 서버 콜백 → `metacode://auth?code=<일회용 코드>` 딥링크로 앱 복귀 → 앱이 일회용 코드를 토큰으로 교환. Electron 창 안에서 GitHub 로그인 페이지를 직접 띄우지 않습니다.

## 도메인 모델 (초안)

Phase 1~2에서 Prisma 스키마로 구체화합니다. 바꿔도 되지만 바꾸면 여기도 고칩니다.

- `User`: githubId, username, avatarUrl, characterId
- `Community`: name, ownerId / `CommunityMember`: userId, communityId, role
- `Channel`: type(`TEXT` | `VOICE` | `DM` | `GROUP_DM`), communityId(DM이면 null), name, proximityVoice(`VOICE`, `DM`, `GROUP_DM`에서 사용)
  - `ChannelMember`: DM 참여자. 커뮤니티 채널의 접근은 커뮤니티 멤버십(추후 채널 권한)으로 판단
  - 광장은 테이블이 아닙니다. 채널에서 계산합니다: `TEXT`·`VOICE` → `community:<communityId>`(분수 광장), `DM`·`GROUP_DM` → `dm:<channelId>`(모닥불 캠프)
- `Message`: channelId(`TEXT`, `DM`, `GROUP_DM`), authorId, content, createdAt / `Attachment`: messageId, url, mimeType, size(기본 최대 50MB)
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
  main/                 # Electron 메인 프로세스 (창, 딥링크, 알림, 자동 업데이트)
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

작업을 마치기 전에 `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`가 통과하는지 확인합니다 (CI와 같은 순서).

## 미결정 사항

사용자와 정해야 하는 항목입니다. 정해지면 이 목록에서 지우고 "확정된 결정"에 옮깁니다.

테마 기능을 만들기 전까지 정하면 됩니다.

- 테마 적용 주체: 운영자가 전체에 일괄 적용(기간 예약)하는지, 커뮤니티 관리자가 고르는지, 둘 다인지
- 테마 범위: 광장 맵만인지, 캐릭터 소품(모자 등)까지인지, 채팅 UI까지인지
