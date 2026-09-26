export interface UserProfile {
  id: string;
  /** GitHub 로그인 이름 */
  username: string;
  /** GitHub 프로필 이름. 설정하지 않았으면 null */
  displayName: string | null;
  avatarUrl: string;
}
