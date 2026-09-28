/**
 * Electron preload가 `window.metacode`로 노출하는 브리지.
 * 웹 코드는 electron을 직접 import하지 않고 이 브리지만 쓴다. 브라우저에서는 undefined다.
 */
export interface MetaCodeDesktopBridge {
  platform: 'desktop';
  os: string;
  versions: {
    electron: string;
    chrome: string;
  };
  auth: DesktopAuthBridge;
  /** 인증이 필요한 주소(첨부 파일 등)를 내려받는다. 저장 위치는 OS 저장 창에서 고른다. */
  download(url: string): Promise<void>;
  /** 화면 공유할 화면/창 고르기. 0.1.0 앱에는 없다 (앱을 업데이트해야 화면 공유를 쓸 수 있음) */
  screen?: DesktopScreenBridge;
  /** 자동 업데이트. 0.3.0부터 있다 (없으면 자동 업데이트가 안 되는 옛 앱) */
  updates?: DesktopUpdatesBridge;
  /** 앱 밖(metacode:// 초대 링크)에서 온 이동. 0.4.0부터 있다 */
  navigation?: DesktopNavigationBridge;
}

/** 브라우저의 "앱에서 열기"로 이미 켜진 앱에 초대 링크가 오면, 새로 고치지 않고 그 화면으로 옮긴다 */
export interface DesktopNavigationBridge {
  /** 옮길 앱 화면 경로(예: /invite/AbCd2345)를 받는다. 반환값을 호출하면 구독이 해제된다. */
  onNavigate(listener: (route: string) => void): () => void;
}

/** 다 받아서 설치만 하면 되는 새 버전 */
export interface UpdateReadyInfo {
  version: string;
}

/**
 * 데스크톱 자동 업데이트. 새 버전은 메인 프로세스가 백그라운드에서 받아 두고 앱을 끌 때 설치한다.
 * 웹 화면은 받아 둔 것이 있으면 "다시 시작" 안내를 띄운다.
 */
export interface DesktopUpdatesBridge {
  /** 이미 받아 둔 새 버전. 없으면 null */
  getReady(): Promise<UpdateReadyInfo | null>;
  /** 새 버전을 다 받으면 호출된다. 반환값을 호출하면 구독이 해제된다. */
  onReady(listener: (info: UpdateReadyInfo) => void): () => void;
  /** 앱을 끄고 새 버전을 설치한 뒤 다시 켠다 */
  install(): Promise<void>;
}

/** 공유할 수 있는 화면이나 창 */
export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** 미리보기 이미지 (data URL) */
  thumbnail: string;
}

/**
 * 데스크톱 화면 공유. Electron은 브라우저처럼 고르는 창을 띄우지 않으므로 웹 화면이 목록을 보여 주고,
 * 고른 것을 select로 알린 뒤 getDisplayMedia를 부른다.
 */
export interface DesktopScreenBridge {
  getSources(): Promise<ScreenSource[]>;
  /** 다음 getDisplayMedia 요청에 쓸 화면. 30초 안에 쓰지 않으면 잊는다 */
  select(sourceId: string): Promise<void>;
}

/**
 * 데스크톱 로그인. 토큰은 메인 프로세스가 보관하고(리프레시 토큰은 OS 암호화 저장소),
 * 렌더러는 필요할 때 액세스 토큰만 받아 간다.
 */
export interface DesktopAuthBridge {
  /** 시스템 브라우저로 GitHub 로그인을 연다. 완료되면 onChanged가 호출된다. */
  login(): Promise<void>;
  logout(): Promise<void>;
  /** 유효한 액세스 토큰. 만료가 가까우면 갱신해서 준다. 로그인 전이면 null */
  getAccessToken(): Promise<string | null>;
  /** 로그인/로그아웃 상태가 바뀌면 호출된다. 반환값을 호출하면 구독이 해제된다. */
  onChanged(listener: () => void): () => void;
}

declare global {
  interface Window {
    metacode?: MetaCodeDesktopBridge;
  }
}
