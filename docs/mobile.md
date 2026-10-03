# 네이티브 안드로이드 앱 (apps/mobile)

웹을 감싼 예전 앱(`apps/android`, Capacitor)을 대신할 React Native 앱입니다. Expo SDK 57 + Expo Router를 쓰고,
네이티브 프로젝트(`android/`)는 커밋하지 않고 `app.config.ts`로 만듭니다 (`expo prebuild`).
모든 화면을 네이티브로 만들 때까지는 Release로 올리지 않고, 예전 앱이 `android-v*` 태그로 계속 배포됩니다.

## 필요한 것

- Node 24, pnpm (루트 README "시작하기")
- JDK 21 (예: Eclipse Temurin)
- Android SDK: Android Studio를 설치하면 `%LOCALAPPDATA%\Android\Sdk`에 생깁니다. NDK·CMake는 Gradle이 처음 빌드할 때 받습니다.
- 확인할 기기: USB 디버깅을 켠 안드로이드 휴대폰, 또는 Android Studio의 에뮬레이터(Device Manager에서 이미지 설치)

환경변수 (Git Bash 예):

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
```

## 개발

> Windows에서는 로컬 Gradle 빌드가 C++ 단계에서 `ninja: manifest 'build.ninja' still dirty after 100 tries`로 실패합니다 (pnpm이 만든 연결 폴더를 CMake가 계속 다시 확인함). 네이티브 빌드는 Actions의 `Mobile Build`(ubuntu)가 만든 APK를 받아 설치하고, 로컬에서는 Metro로 JS만 바꿉니다. macOS·Linux·WSL에서는 아래 명령이 그대로 됩니다.

서버는 평소처럼 `pnpm dev`로 띄웁니다. 앱은 개발 빌드(dev client)를 한 번 설치한 뒤 Metro에 붙어 코드를 바로 반영합니다.

```bash
# 기기에서 PC의 서버(3000)와 Metro(8081)에 닿게 한다 (USB 연결 기기·에뮬레이터)
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081

# 개발 빌드를 만들어 설치하고 Metro를 띄운다 (처음 한 번은 오래 걸림)
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm --filter @metacode/mobile android
```

- 로그인은 GitHub OAuth App의 콜백이 서버(`/auth/github/callback`)라서 개발용 OAuth App 그대로 됩니다. 가짜 GitHub(`tools/fake-github.mjs`)로 할 때는 Custom Tab도 `localhost:4010`에 닿아야 하므로 `adb reverse tcp:4010 tcp:4010`을 더 합니다.
- 네이티브 설정(`app.config.ts`, 설정 플러그인, 네이티브 모듈 추가)을 바꾸면 `pnpm --filter @metacode/mobile prebuild -- --clean` 후 다시 빌드합니다.

## APK 만들기

```bash
pnpm --filter @metacode/mobile exec expo prebuild --platform android --no-install
cd apps/mobile/android
./gradlew assembleRelease   # 서명 설정 전에는 디버그 키로 서명됨
```

`Mobile Build` 워크플로가 같은 방법으로 APK를 만들어 아티팩트로 남깁니다. 빌드가 10분 넘게 걸려서 지금은 PR마다 돌리지 않고, 필요할 때 GitHub Actions → Mobile Build → Run workflow(브랜치 고르기)로 실행합니다. 실행할 때 만들 APK(`dev` 개발 빌드만 / `release` JS를 넣은 빌드만 / `both`)와 CPU 종류(기본 arm64-v8a 하나)를 고릅니다. 개발 빌드 + arm64 하나가 가장 빠르고, 둘 다 두 CPU용으로 만들면 20분 넘게 걸립니다. 명령줄: `gh workflow run "Mobile Build" --ref <브랜치> -f variant=dev`.

## 인증

데스크톱 앱과 같은 토큰 방식입니다.

1. Custom Tab으로 `GET /auth/github?client=android&code_challenge=<PKCE>`를 엽니다.
2. 서버가 `metacode://auth?code=<일회용 코드>`로 돌려보냅니다.
3. 앱이 `POST /auth/android/token {code, codeVerifier}`로 토큰을 받습니다. 액세스 토큰은 메모리에, 리프레시 토큰은 SecureStore(안드로이드 Keystore)에 둡니다.
4. API는 `Authorization: Bearer`, 갱신은 `POST /auth/refresh {refreshToken}`입니다.

## 예전 앱을 대신할 때

- 패키지 이름(`me.kimyangmin.metacode`)과 서명 키가 같아야 덮어 설치됩니다. versionCode는 버전으로 계산하므로(1.0.0 → 10000) 예전 앱(0.x)보다 큽니다.
- `android-release.yml`을 `apps/mobile`을 빌드하도록 바꾸고, `apps/android`와 서버의 `android/session`, 웹의 `platform/android.ts`를 정리합니다.
- 예전 앱의 로그인(쿠키)은 이어지지 않으므로 한 번 다시 로그인해야 합니다.
