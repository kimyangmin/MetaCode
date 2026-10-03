import {
  type MouseEvent,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { UserProfile } from '@metacode/shared';
import { type Block, type Inline, displayName, parseMarkdown } from '@metacode/client';
import { CodeBlock } from './CodeBlock';

/**
 * 멘션(@사용자ID)을 누구로 그릴지. 채팅 목록이 그 채널의 사람들로 채워 준다. 모르는 사람이면 글자 그대로.
 */
export interface MentionResolver {
  find(username: string): UserProfile | undefined;
  meId: string;
  onOpen?(user: UserProfile, e: MouseEvent<HTMLElement>): void;
}

export const MentionContext = createContext<MentionResolver | null>(null);

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
      return <CodeBlock lang={block.lang} value={block.value} />;
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
      case 'mention':
        return <Mention key={i} username={node.username} />;
    }
  });
}

/** 멘션: 아는 사람이면 @닉네임 표시 (누르면 정보 팝업), 나를 부른 것이면 강조 */
function Mention({ username }: { username: string }) {
  const resolver = useContext(MentionContext);
  const user = resolver?.find(username);
  if (!user) return `@${username}`;
  return (
    <span
      className="md-mention"
      data-me={user.id === resolver!.meId || undefined}
      role="button"
      tabIndex={0}
      title={`@${user.username}`}
      onClick={(e) => resolver!.onOpen?.(user, e)}
    >
      @{displayName(user)}
    </span>
  );
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
