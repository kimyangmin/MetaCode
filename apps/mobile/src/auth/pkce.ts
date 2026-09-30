import * as Crypto from 'expo-crypto';

/** base64 → base64url (RFC 4648 §5), 끝의 = 없음 */
export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return toBase64Url(btoa(binary));
}

/** PKCE (RFC 7636): 무작위 verifier와 그 SHA-256 challenge */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = bytesToBase64Url(Crypto.getRandomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: toBase64Url(digest) };
}
