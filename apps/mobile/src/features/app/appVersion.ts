/** GitHub Releases에서 안드로이드 앱 Release를 고를 때 쓰는 태그 머리 (android-release.yml) */
export const ANDROID_TAG_PREFIX = 'android-v';

/** 1.2.3 → [1, 2, 3]. 숫자가 아닌 칸은 0 */
function parts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** a가 b보다 새 버전이면 양수, 같으면 0, 낮으면 음수 */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface ReleaseInfo {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

/** Release 목록에서 지금 버전보다 새 안드로이드 앱 Release 중 가장 새 것 (없으면 null) */
export function newerRelease(
  releases: readonly ReleaseInfo[],
  current: string,
): { version: string; url: string } | null {
  let best: { version: string; url: string } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith(ANDROID_TAG_PREFIX)) continue;
    const version = r.tag_name.slice(ANDROID_TAG_PREFIX.length);
    if (compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, url: r.html_url };
  }
  return best;
}
