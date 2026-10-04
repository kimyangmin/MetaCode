# 안드로이드 앱 (예전, Capacitor)

> **예전 앱입니다.** 1.0.0부터 `android-v*` Release는 네이티브 앱(`apps/mobile`, [docs/mobile.md](mobile.md))을 올립니다. 같은 패키지 이름·서명 키라 이 앱(0.x) 위에 덮어 설치됩니다. 이 앱을 쓰는 사람에게는 웹이 "새 앱 받기"를 띄웁니다 (`UpdateNotice`). 모두 옮겨 가면 `apps/android`, 서버의 `POST /auth/android/session`, 웹의 `platform/android.ts`를 지웁니다. 아래 서명 키 만들기는 새 앱도 그대로 씁니다.

`apps/android`는 [Capacitor](https://capacitorjs.com)로 만든 안드로이드 앱입니다. 데스크톱 앱처럼 **운영 웹(`https://metacode.kimyangmin.me`)을 앱 창(WebView)에서 여는 셸**이라, 웹을 배포하면 앱 화면도 바로 최신이 됩니다. 앱(APK)을 새로 내야 하는 것은 네이티브 쪽(권한, 딥링크, 아이콘, 플러그인)을 바꿨을 때뿐입니다.

배포는 GitHub Releases의 서명한 APK입니다 (Play 스토어 아님). 사용자는 Release 페이지에서 APK를 받아 "출처를 알 수 없는 앱" 설치를 허용하고 설치합니다.

## 구조

| 위치 | 내용 |
| --- | --- |
| `apps/android/capacitor.config.json` | 앱 ID `me.kimyangmin.metacode`, 여는 주소(`server.url`), User-Agent에 붙일 `MetaCodeAndroid` |
| `apps/android/android/` | 네이티브 프로젝트 (Gradle). `cap sync`가 설정과 플러그인을 넣는다 |
| `apps/android/www/` | `cap sync`에 필요한 빈 페이지와 서버에 닿지 않을 때의 `offline.html` |
| `apps/android/scripts/icons.mjs` | 앱 아이콘·시작 화면(도트 모닥불)을 만드는 스크립트 |
| `apps/web/src/platform/android.ts` | 웹 쪽의 앱 전용 기능 (앱 안에서만 불러옴) |
| `.github/workflows/android-release.yml` | `android-v*` 태그 → 서명한 APK를 Release로 |

- **로그인:** 앱 창 안에서 GitHub 로그인을 띄우지 않고, 시스템 브라우저(Custom Tab)로 `GET /auth/github?client=android&code_challenge=…`를 엽니다. 로그인이 끝나면 서버가 `metacode://auth?code=<일회용 코드>`로 돌려보내고(자동으로 열고, 막히면 "앱으로 돌아가기" 버튼), 앱이 `POST /auth/android/session {code, codeVerifier}`로 **웹과 같은 로그인 쿠키**를 받습니다. 이후 인증·갱신은 웹과 똑같습니다. 코드는 60초 한 번만, PKCE verifier가 있어야 쓸 수 있어서 다른 앱이 스킴을 가로채도 로그인할 수 없습니다.
- **딥링크:** `metacode://auth?…`(로그인 결과)와 `metacode://invite/<코드>`(초대 링크)를 받습니다.
- **첨부 받기:** 앱 창은 파일을 받지 못하므로 `GET /attachments/:id/link`로 권한을 확인한 짧게 유효한 주소를 받아 시스템 브라우저로 엽니다.
- **음성:** 통화에 들어갈 때 마이크 권한을 묻습니다. 화면 공유는 WebView가 지원하지 않아 버튼을 숨깁니다 (다른 사람의 공유 보기는 됩니다).
- **뒤로 가기:** 열린 서랍·창을 먼저 닫고, 없으면 앞 화면으로, 더 없으면 앱을 내립니다.
- **로그인 유지:** 쿠키는 WebView가 보관하고, 앱이 가려질 때 바로 디스크에 씁니다(`MainActivity`). 로그인 쿠키가 기기 백업으로 빠져나가지 않게 백업을 끕니다.
- 앱 화면은 휴대폰 화면(768px 이하)에 맞춰 목록은 왼쪽 서랍(☰), 멤버는 오른쪽 서랍(반대쪽으로 밀어 닫기), 채팅과 광장은 위아래로 나눠 봅니다(광장이 위, 머리글 ☰ 옆에 관리자용 채널 설정). 휴대폰 브라우저에서도 같습니다.

## 처음 한 번: 서명 키 만들기

안드로이드는 같은 키로 서명한 APK만 덮어 설치(업데이트)할 수 있습니다. **키를 잃어버리면 사용자가 앱을 지우고 다시 설치해야 하므로** 안전한 곳에 따로 보관합니다.

1. JDK의 `keytool`로 키를 만듭니다 (비밀번호는 직접 정함).
   ```bash
   keytool -genkeypair -v -keystore metacode-release.jks -alias metacode -keyalg RSA -keysize 4096 -validity 36500
   ```
2. GitHub 저장소 → Settings → Secrets and variables → Actions에 비밀값 네 개를 넣습니다.

   | 이름 | 값 |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 metacode-release.jks`의 출력 (Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("metacode-release.jks"))`) |
   | `ANDROID_KEYSTORE_PASSWORD` | 키 저장소 비밀번호 |
   | `ANDROID_KEY_ALIAS` | `metacode` |
   | `ANDROID_KEY_PASSWORD` | 키 비밀번호 (따로 정하지 않았으면 저장소 비밀번호와 같음) |

`.jks` 파일은 저장소에 올리지 않습니다.

## 새 버전 내기

1. 서버가 먼저 배포되어 있어야 합니다 (안드로이드 로그인과 첨부 받기는 서버의 새 API를 씀).
2. `apps/android/package.json`의 `version`을 올려서 `main`에 병합합니다. `versionCode`는 버전에서 자동으로 만듭니다 (1.2.3 → 10203).
3. 그 커밋에 `android-v<버전>` 태그를 달아 push합니다.
   ```bash
   git tag android-v0.1.0 && git push origin android-v0.1.0
   ```
4. `Android Release` 워크플로가 APK(`MetaCode-<버전>.apk`)를 만들어 Release로 올립니다. 태그와 package.json 버전이 다르거나 서명 키 비밀값이 없으면 실패합니다.

- **Latest로 올리지 않습니다.** 데스크톱 앱은 저장소의 Latest Release를 보고 업데이트를 확인하므로, 안드로이드 Release가 Latest가 되면 데스크톱 업데이트가 깨집니다 (워크플로가 `--latest=false`로 올림).
- 빌드만 확인하려면 Actions에서 `Android Release`를 손으로 실행합니다. Release 없이 APK를 아티팩트로 남깁니다 (서명 키가 없으면 디버그 서명).

## 개발

Android Studio(또는 Android SDK + JDK 21)가 있어야 합니다.

```bash
pnpm --filter @metacode/android sync   # 설정·플러그인을 네이티브 프로젝트에 넣기 (capacitor.config.json을 바꾼 뒤에도)
pnpm --filter @metacode/android open   # Android Studio로 열기
```

- 앱은 운영 주소를 엽니다. 로컬 서버로 확인하려면 `capacitor.config.json`의 `server.url`을 잠시 바꾸고(에뮬레이터에서 PC는 `http://10.0.2.2:5173`, `"cleartext": true` 필요) 웹을 `VITE_API_URL=http://10.0.2.2:3000`으로, 서버를 `WEB_ORIGIN=http://10.0.2.2:5173`으로 띄웁니다. 로그인은 GitHub OAuth App의 콜백 주소까지 맞춰야 해서 번거로우므로, 보통은 서버·웹을 운영에 배포한 뒤 운영 주소로 확인합니다. 확인이 끝나면 되돌립니다.
- 휴대폰 화면 자체는 PC 브라우저의 기기 모드(폭 768px 이하)로 대부분 확인할 수 있습니다.
- WebView 디버깅: 디버그 빌드는 PC Chrome의 `chrome://inspect`에서 앱 화면을 볼 수 있습니다.
- 아이콘·시작 화면을 바꾸려면 `scripts/icons.mjs`를 고치고 `node apps/android/scripts/icons.mjs`를 실행해 만든 파일을 커밋합니다.
- `capacitor.settings.gradle`, `app/capacitor.build.gradle`, `assets/`는 `cap sync`가 만드는 파일이라 커밋하지 않습니다 (pnpm 설치 경로가 들어감).
