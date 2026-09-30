/** 초대 링크 전체(웹 주소, 해시 주소)나 코드만 붙여 넣어도 코드를 꺼낸다. */
export function parseInviteCode(input: string): string | null {
  const match = input.trim().match(/(?:^|invite\/)([A-Za-z0-9]{4,32})\/?$/);
  return match?.[1] ?? null;
}
