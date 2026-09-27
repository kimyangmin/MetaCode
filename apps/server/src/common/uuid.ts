import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562): 앞 48비트가 밀리초 시각이라 생성 순서대로 정렬된다.
 * DB 기본값(uuid(7))과 같은 형식이며, 저장하기 전에 ID가 필요할 때(파일 위치를 ID로 만드는 경우) 쓴다.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const now = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((now >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
