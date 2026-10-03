# 에셋 출처

광장의 내장 에셋은 아래 원본과 직접 그린 그림으로 만듭니다. 원본은 모두 CC0(퍼블릭 도메인)이라 출처 표기 의무는 없지만 여기에 적어 둡니다.

| 원본 | 만든 사람 | 라이선스 | 파일 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| [Tiny Town](https://kenney.nl/assets/tiny-town) (1.1) | Kenney (www.kenney.nl) | [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/) | `vendor/kenney-tiny-town/` | 16×16 타일 전부 (`builtin:tt-<번호>`) |
| [16x16 base sprites](https://opengameart.org/content/16x16-base-sprites) | Unnamed (OpenGameArt) | CC0 | `vendor/base-sprites/` | 기본 캐릭터의 몸 (`builtin:char-short`, `builtin:char-long`) |
| New Notification 040 (`universfield-new-notification-040-493469.mp3`, 사용자가 준 파일) | Universfield (Pixabay) | [Pixabay Content License](https://pixabay.com/service/license-summary/) | `apps/web/src/assets/sounds/notification.mp3` | 기본 메시지 알림음 |

직접 그린 것 (`tools/assets/`, 같은 저장소의 라이선스를 따름):

- 분수, 모닥불, 벤치, 통나무, 큰 나무, 뾰족한 나무, 가로등, 물 타일. Kenney Tiny Town의 색과 외곽선(#3f2631)에 맞춰 그렸습니다.
- 기본 캐릭터의 머리, 옷, 첨부 모션(손 흔들기). base sprites의 몸을 16×32에 맞게 줄이고(머리 한 줄, 다리 한 줄) 부위별로 칠했습니다.

## 다시 만들기

```bash
pnpm assets:build
```

`packages/shared/src/assets/builtin/assets.json`을 다시 씁니다. `--preview <폴더>`를 붙이면 오브젝트와 캐릭터의 모든 프레임을 4배로 키운 PNG도 만듭니다.
