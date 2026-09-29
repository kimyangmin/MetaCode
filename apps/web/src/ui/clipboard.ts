/**
 * 글을 클립보드에 넣는다. Clipboard API가 막혀 있으면(권한, 포커스, 일부 내장 브라우저) 예전 방식
 * (숨긴 입력칸 + execCommand('copy'))으로 한 번 더 해 본다. 둘 다 안 되면 거절한다.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 아래 방식으로 다시 시도한다.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
  const previous = document.activeElement as HTMLElement | null;
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  previous?.focus?.({ preventScroll: true });
  if (!ok) throw new Error('클립보드에 넣지 못했습니다.');
}
