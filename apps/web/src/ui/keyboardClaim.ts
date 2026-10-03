/**
 * 키보드를 잠깐 혼자 쓰는 것들(펼친 고르기 칸, 키 입력 받기)이 있는지. 에디터의 단축키(Esc로 닫기, 도구 키 등)는
 * 이때 아무것도 하지 않는다. window 캡처 리스너는 등록 순서대로 불려서 먼저 막는 것을 믿을 수 없기 때문이다.
 */
let claims = 0;

export function isKeyboardClaimed(): boolean {
  return claims > 0;
}

/** 키보드를 쓰기 시작한다. 돌려준 함수로 놓는다 (effect 정리 함수로 쓴다) */
export function claimKeyboard(): () => void {
  claims++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims--;
  };
}
