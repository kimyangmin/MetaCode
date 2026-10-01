import { type ReactNode, useEffect, useMemo, useState } from 'react';

type Lowlight = ReturnType<typeof import('lowlight').createLowlight>;
type HastNode = ReturnType<Lowlight['highlight']>['children'][number];

/**
 * lowlight(highlight.js, 자주 쓰는 언어 약 40개)는 언어가 붙은 코드 블록을 처음 그릴 때 따로 불러온다
 * (gzip 약 50KB). 한 번 불러오면 이 값을 써서 다음 블록부터는 바로 색을 입힌다.
 */
let loaded: Lowlight | null = null;
let loading: Promise<Lowlight> | null = null;

function loadLowlight(): Promise<Lowlight> {
  loading ??= import('lowlight').then(({ createLowlight, common }) => {
    loaded = createLowlight(common);
    return loaded;
  });
  return loading;
}

/**
 * 마크다운 코드 블록. ```언어 로 언어를 적었고 lowlight가 아는 언어(별칭 포함: js, ts, py, sh…)면 색을 입힌다.
 * 결과(hast 트리)를 React 요소로 그리므로 HTML을 그대로 넣지 않는다. 모르는 언어나 불러오는 동안은 그냥 글자다.
 */
export function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [lowlight, setLowlight] = useState(loaded);
  useEffect(() => {
    if (!lang || lowlight) return;
    let cancelled = false;
    loadLowlight().then(
      (l) => !cancelled && setLowlight(l),
      () => {}, // 불러오지 못하면 색 없이 둔다
    );
    return () => {
      cancelled = true;
    };
  }, [lang, lowlight]);

  const tree = useMemo(() => {
    const name = lang.toLowerCase();
    if (!lowlight || !name || !lowlight.registered(name)) return null;
    try {
      return lowlight.highlight(name, value).children;
    } catch {
      return null;
    }
  }, [lowlight, lang, value]);

  return (
    <pre className="md-codeblock" data-lang={lang || undefined}>
      <code>{tree ? <HastNodes nodes={tree} /> : value}</code>
    </pre>
  );
}

function HastNodes({ nodes }: { nodes: HastNode[] }): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    const classes = node.properties.className;
    return (
      <span key={i} className={Array.isArray(classes) ? classes.join(' ') : undefined}>
        <HastNodes nodes={node.children} />
      </span>
    );
  });
}
