import { Fragment, type ReactNode } from 'react';
import { Markdown } from '../../ui/Markdown';

/** 키 하나 또는 조합. '+'로 잇는다 (예: 'Ctrl+Shift') */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="feature-guide__keys">
      {keys.split(' / ').map((combo, i) => (
        <Fragment key={combo}>
          {i > 0 && <span className="feature-guide__or">/</span>}
          {combo.split('+').map((key, j) => (
            <Fragment key={key}>
              {j > 0 && <span className="feature-guide__plus">+</span>}
              <kbd>{key}</kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

interface Shortcut {
  keys: string;
  what: ReactNode;
}

const SHORTCUTS: { title: string; items: Shortcut[] }[] = [
  {
    title: '이동',
    items: [
      { keys: 'Ctrl+1', what: 'DM' },
      { keys: 'Ctrl+2~9', what: '왼쪽 목록의 첫 번째~여덟 번째 커뮤니티' },
      { keys: 'Ctrl+0', what: '아홉 번째 커뮤니티' },
    ],
  },
  {
    title: '채팅',
    items: [
      { keys: 'Enter', what: '보내기' },
      { keys: 'Shift+Enter', what: '줄 바꾸기' },
      { keys: 'Esc', what: '답장 취소 · 광장에서 /로 왔으면 광장으로 돌아가기' },
      { keys: 'Ctrl+Shift', what: '함께 눌렀다 떼면 메시지 잡기 시작 (화면 맨 아래 메시지부터)' },
      { keys: '↑ / ↓', what: '잡기 중: 한 칸 옮기기' },
      { keys: 'Shift+↑ / Shift+↓', what: '잡기 중: 범위 늘리기 (메시지를 끌어도 됨)' },
      { keys: 'D', what: '잡기 중: 범위 안의 내 메시지 삭제 (커뮤니티 관리자는 모든 메시지)' },
      { keys: 'C', what: '잡기 중: 대화 기록 복사' },
      { keys: 'F', what: '잡기 중: 전달' },
      { keys: 'Esc', what: '잡기 끝' },
    ],
  },
  {
    title: '광장',
    items: [
      { keys: '← / ↑ / → / ↓', what: '캐릭터 움직이기 (광장을 누른 뒤)' },
      { keys: '클릭', what: '누른 곳으로 걸어가기 (휴대폰은 탭)' },
      { keys: '← / →', what: '횡스크롤 광장: 걷기' },
      { keys: 'Space / ↑', what: '횡스크롤 광장: 점프 (누르고 있으면 높이 뜁니다)' },
      { keys: '↓', what: '횡스크롤 광장: 발판에서 내려가기' },
      { keys: 'Ctrl+= / Ctrl+-', what: '광장 확대 · 축소 (Ctrl+휠, 트랙패드 모아 벌리기도)' },
      {
        keys: '모션 키',
        what: '도트 에디터에서 모션·애니메이터 파라미터에 직접 단 키 (처음엔 1~0, Z X C …). 반복 모션은 다시 누르거나 움직이면 멈추고, 콤보는 치는 중에 다시, 모아 쏘기는 누르고 있다가 뗍니다',
      },
      { keys: '/', what: '채팅 입력창으로. 보내면 광장으로 돌아옵니다' },
      { keys: 'Shift+Tab', what: '광장 ↔ 채팅 입력창' },
    ],
  },
  {
    title: '화면 공유 보기',
    items: [
      { keys: '머리글 두 번 클릭', what: '크게 보기' },
      { keys: '영상 두 번 클릭', what: '전체 화면' },
      { keys: 'Esc', what: '전체 화면 끝내기 · 보기 창 닫기' },
    ],
  },
  {
    title: '도트 에디터',
    items: [
      { keys: 'B / E / G / I', what: '연필 · 지우개 · 채우기 · 스포이트' },
      { keys: 'L / C', what: '올가미 · 자르기' },
      { keys: 'M', what: '좌우 대칭' },
      { keys: 'O', what: '앞 프레임 겹쳐 보기' },
      { keys: '← / →', what: '프레임 넘기기 (고른 영역이 있으면 한 칸 옮기기)' },
      { keys: 'Ctrl+Z', what: '되돌리기' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', what: '다시 하기' },
      { keys: 'Ctrl+A', what: '모두 고르기' },
      { keys: 'Ctrl+C / Ctrl+X / Ctrl+V', what: '복사 · 잘라내기 · 붙여넣기 (같은 자리에)' },
      { keys: 'Delete', what: '고른 곳 지우기' },
      { keys: 'Enter', what: '자르기 적용' },
      { keys: '오른쪽 버튼', what: '지우개' },
      { keys: '[ / ]', what: '붓 가늘게 · 굵게' },
      { keys: 'Ctrl+= / Ctrl+-', what: '그림판 확대 · 축소 (Ctrl+휠도, 맵 에디터도 같음)' },
      { keys: 'Ctrl+0', what: '그림판을 창에 맞추기' },
      { keys: 'Esc', what: '애니메이터에서 그림으로 돌아가기 · 에디터 닫기' },
    ],
  },
];

/** 쓰는 법 → 보이는 모양. 보이는 모양은 채팅과 같은 부품(Markdown)으로 그린다 */
const MARKDOWN: { syntax: string; label: string }[] = [
  { syntax: '**굵게**', label: '굵게' },
  { syntax: '*기울임* _기울임_', label: '기울임' },
  { syntax: '__밑줄__', label: '밑줄' },
  { syntax: '~~취소선~~', label: '취소선' },
  { syntax: '||스포일러||', label: '스포일러 (누르면 보임)' },
  { syntax: '`코드`', label: '글 속 코드' },
  { syntax: '```\n코드 블록\n```', label: '코드 블록' },
  {
    syntax: '```ts\nconst hello = "world";\n```',
    label: '언어별 색 (js, ts, py, java, c, cpp, go, rust, sql, sh, json, html, css 등)',
  },
  { syntax: '[링크](https://example.com)', label: '링크 (http, https만)' },
  { syntax: '# 제목\n## 작은 제목\n### 더 작은 제목', label: '제목' },
  { syntax: '> 인용', label: '인용 (한 줄)' },
  { syntax: '>>> 여기부터\n끝까지 인용', label: '끝까지 인용' },
  { syntax: '- 목록\n- 목록', label: '목록' },
  { syntax: '1. 첫째\n2. 둘째', label: '번호 목록' },
  { syntax: '\\*별표 그대로\\*', label: '기호 그대로 쓰기' },
];

/** 설정 → 기능: 단축키와 채팅에서 쓸 수 있는 마크다운 */
export function FeatureGuide() {
  return (
    <div className="settings-form feature-guide">
      <h3 className="settings-form__title">단축키</h3>
      {SHORTCUTS.map((group) => (
        <section key={group.title} className="feature-guide__group">
          <h4>{group.title}</h4>
          <dl>
            {group.items.map((item, i) => (
              <div key={i} className="feature-guide__row">
                <dt>
                  <Keys keys={item.keys} />
                </dt>
                <dd>{item.what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <h3 className="settings-form__title">마크다운</h3>
      <p className="form__hint">
        메시지에 아래처럼 쓰면 모양이 바뀝니다. 광장 말풍선에는 기호를 뺀 글만 보입니다.
      </p>
      <div className="feature-guide__markdown">
        {MARKDOWN.map((item) => (
          <div key={item.syntax} className="feature-guide__md-row">
            <span className="feature-guide__md-label">{item.label}</span>
            <code className="feature-guide__syntax">{item.syntax}</code>
            <div className="message__content feature-guide__preview">
              <Markdown text={item.syntax} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
