import { type ReactNode, useMemo, useState } from 'react';
import { type Block, type Inline, parseMarkdown } from '@metacode/client';

/**
 * 채팅 메시지 글을 마크다운으로 그린다 (parseMarkdown의 트리 → React 요소, HTML은 해석하지 않음).
 * suffix는 마지막 문단 끝에 붙인다 ("(수정됨)" 표시가 글 바로 뒤에 오도록).
 */
export function Markdown({ text, suffix }: { text: string; suffix?: ReactNode }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const last = blocks.length - 1;
  const inlineSuffix = blocks[last]?.type === 'paragraph';
  return (
    <>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} suffix={i === last && inlineSuffix ? suffix : null} />
      ))}
      {!inlineSuffix && suffix}
    </>
  );
}

function BlockView({ block, suffix }: { block: Block; suffix?: ReactNode }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="md-paragraph">
          <InlineView nodes={block.children} />
          {suffix}
        </p>
      );
    case 'code':
      return (
        <pre className="md-codeblock" data-lang={block.lang || undefined}>
          <code>{block.value}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="md-quote">
          {block.children.map((child, i) => (
            <BlockView key={i} block={child} />
          ))}
        </blockquote>
      );
    case 'heading': {
      const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1]!;
      return (
        <Tag className={`md-heading md-heading--${block.level}`}>
          <InlineView nodes={block.children} />
        </Tag>
      );
    }
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <InlineView nodes={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="md-list" start={block.start}>
          {items}
        </ol>
      ) : (
        <ul className="md-list">{items}</ul>
      );
    }
  }
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'code':
        return (
          <code key={i} className="md-code">
            {node.value}
          </code>
        );
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer" title={node.href}>
            <InlineView nodes={node.children} />
          </a>
        );
      case 'bold':
        return (
          <strong key={i}>
            <InlineView nodes={node.children} />
          </strong>
        );
      case 'italic':
        return (
          <em key={i}>
            <InlineView nodes={node.children} />
          </em>
        );
      case 'underline':
        return (
          <u key={i}>
            <InlineView nodes={node.children} />
          </u>
        );
      case 'strike':
        return (
          <s key={i}>
            <InlineView nodes={node.children} />
          </s>
        );
      case 'spoiler':
        return <Spoiler key={i} nodes={node.children} />;
    }
  });
}

/** 스포일러: 누르기 전에는 가려져 있다 */
function Spoiler({ nodes }: { nodes: Inline[] }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className="md-spoiler"
      data-shown={shown}
      role={shown ? undefined : 'button'}
      tabIndex={shown ? undefined : 0}
      aria-label={shown ? undefined : '스포일러 보기'}
      onClick={() => setShown(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setShown(true);
      }}
    >
      <InlineView nodes={nodes} />
    </span>
  );
}
