import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { TokenStorage } from './auth';

/**
 * 리프레시 토큰을 OS 암호화 저장소(Windows DPAPI, macOS Keychain, Linux Secret Service)로
 * 암호화해서 파일에 둔다. 암호화를 쓸 수 없는 환경이면 평문으로 쓰지 않고 메모리에만 둔다
 * (앱을 다시 켜면 로그인이 필요하다).
 */
export function createTokenStorage(): TokenStorage {
  const file = path.join(app.getPath('userData'), 'session.bin');
  const canEncrypt = safeStorage.isEncryptionAvailable();
  let memory: string | null = null;

  return {
    load() {
      if (!canEncrypt) return memory;
      if (!existsSync(file)) return null;
      try {
        return safeStorage.decryptString(readFileSync(file));
      } catch {
        // 다른 OS 계정에서 암호화했거나 파일이 손상되었다.
        rmSync(file, { force: true });
        return null;
      }
    },
    save(refreshToken) {
      if (!canEncrypt) {
        memory = refreshToken;
        return;
      }
      if (refreshToken === null) rmSync(file, { force: true });
      else writeFileSync(file, safeStorage.encryptString(refreshToken));
    },
  };
}
