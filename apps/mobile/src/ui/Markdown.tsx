import { type Block, type Inline, parseMarkdown } from '@metacode/client';
import type { UserProfile } from '@metacode/shared';
import { Fragment, createContext, useContext, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { useTheme } from './theme';

/** 멘션(@아이디)을 닉네임으로 보여 주려고 그 채널의 사람들을 넘긴다 (웹 MentionContext) */
export const MentionPeople = createContext<UserProfile[]>([]);

const MONO = 'monospace';

/**
 * 메시지 마크다운 (웹 ui/Markdown.tsx와 같은 파서 `parseMarkdown`). HTML을 해석하지 않고 트리를 Text로 그린다.
 * 링크는 http(s)만 파서가 만들고, 누르면 시스템 브라우저로 연다.
 */
export function Markdown({ text, style }: { text: string; style?: TextStyle }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.blocks}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} style={style} />
      ))}
    </View>
  );
}

function BlockView({ block, style }: { block: Block; style?: TextStyle }) {
  const theme = useTheme();
  const base: TextStyle = { color: theme.fg, fontSize: 15, lineHeight: 21, ...style };
  switch (block.type) {
    case 'paragraph':
      return (
        <Text style={base} selectable={false}>
          <Inlines nodes={block.children} />
        </Text>
      );
    case 'heading':
      return (
        <Text style={[base, { fontWeight: '700', fontSize: [0, 22, 19, 17][block.level] }]}>
          <Inlines nodes={block.children} />
        </Text>
      );
    case 'code':
      return (
        <ScrollView
          horizontal
          style={[styles.codeBlock, { backgroundColor: theme.bgInput, borderColor: theme.border }]}
          contentContainerStyle={styles.codeBlockContent}
        >
          <Text style={{ color: theme.fg, fontFamily: MONO, fontSize: 13, lineHeight: 18 }}>
            {block.value}
          </Text>
        </ScrollView>
      );
    case 'quote':
      return (
        <View style={[styles.quote, { borderLeftColor: theme.border }]}>
          {block.children.map((child, i) => (
            <BlockView key={i} block={child} style={style} />
          ))}
        </View>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={[base, styles.bullet]}>
                {block.ordered ? `${block.start + i}.` : '•'}
              </Text>
              <Text style={[base, styles.listText]}>
                <Inlines nodes={item} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <InlineView key={i} node={node} />
      ))}
    </>
  );
}

function InlineView({ node }: { node: Inline }) {
  const theme = useTheme();
  const people = useContext(MentionPeople);
  switch (node.type) {
    case 'text':
      return <>{node.value}</>;
    case 'code':
      return (
        <Text style={{ fontFamily: MONO, fontSize: 13, backgroundColor: theme.bgInput }}>
          {node.value}
        </Text>
      );
    case 'link':
      return (
        <Text
          style={{ color: theme.accent }}
          onPress={() => void Linking.openURL(node.href)}
          accessibilityRole="link"
        >
          <Inlines nodes={node.children} />
        </Text>
      );
    case 'mention': {
      const person = people.find((p) => p.username.toLowerCase() === node.username);
      // 모르는 아이디는 글자 그대로 (웹과 같음)
      if (!person) return <>@{node.username}</>;
      return (
        <Text style={{ color: theme.accent, fontWeight: '600' }}>
          @{person.displayName ?? person.username}
        </Text>
      );
    }
    case 'spoiler':
      return <Spoiler nodes={node.children} />;
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
      return (
        <Text style={MARKS[node.type]}>
          <Inlines nodes={node.children} />
        </Text>
      );
  }
}

const MARKS: Record<'bold' | 'italic' | 'underline' | 'strike', TextStyle> = {
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
};

/** 스포일러: 누르기 전에는 가린다 (웹은 ▒ 덮개, 여기서는 글자색 = 배경색) */
function Spoiler({ nodes }: { nodes: Inline[] }) {
  const theme = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <Text
      onPress={() => setShown(true)}
      style={
        shown
          ? { backgroundColor: theme.bgActive }
          : { backgroundColor: theme.muted, color: theme.muted }
      }
    >
      <Fragment>
        <Inlines nodes={nodes} />
      </Fragment>
    </Text>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 4 },
  codeBlock: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, maxHeight: 360 },
  codeBlockContent: { padding: 10 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, gap: 4 },
  list: { gap: 2 },
  listItem: { flexDirection: 'row', gap: 6 },
  bullet: { minWidth: 16 },
  listText: { flex: 1 },
});
