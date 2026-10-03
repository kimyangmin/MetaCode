import { displayName, markdownToPlain } from '@metacode/client';
import { MESSAGE_MAX_LENGTH, type MessageDto } from '@metacode/shared';
import { Image } from 'expo-image';
import {
  File as FileIcon,
  ImageIcon,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  SendHorizontal,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';
import { type AttachmentDraft, pickFiles, pickImages, useAttachmentDrafts } from './uploads';

/**
 * 입력창 (웹 Composer의 휴대폰판): 답장·고치기 표시, 첨부 미리보기(올리는 진행률), 첨부 버튼, 글, 보내기.
 * 화면 자판의 Enter는 줄 바꾸기이고 보내기 버튼으로 보낸다 (웹 휴대폰과 같음).
 */
export function Composer({
  placeholder,
  initialText,
  editing,
  onCancelEdit,
  drafts,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
}: {
  placeholder: string;
  /** 고치기를 시작하면 그 메시지의 글로 채운다 (부모가 key로 새로 만든다) */
  initialText: string;
  editing: boolean;
  onCancelEdit(): void;
  drafts: ReturnType<typeof useAttachmentDrafts>;
  replyTo: MessageDto | null;
  onCancelReply(): void;
  onSend(content: string): void;
  onTyping(): void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(initialText);
  const [attachMenu, setAttachMenu] = useState(false);

  const content = text.trim();
  const hasAttachments = !editing && drafts.readyAttachments.length > 0;
  // 고칠 때는 글이 있어야 하고(첨부 없는 메시지는 비울 수 없음, 서버가 확인), 보낼 때는 글이나 올라간 첨부
  const canSend = editing
    ? content.length > 0
    : !drafts.uploading && (content.length > 0 || hasAttachments);

  const send = () => {
    if (!canSend) return;
    onSend(content);
    setText('');
  };

  const attach = async (pick: () => Promise<Parameters<typeof drafts.add>[0]>) => {
    setAttachMenu(false);
    try {
      const files = await pick();
      if (files.length > 0) drafts.add(files);
    } catch {
      Alert.alert('파일을 고르지 못했습니다');
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.bg,
          borderTopColor: theme.border,
          paddingBottom: 8 + insets.bottom,
        },
      ]}
    >
      {(replyTo || editing) && (
        <View style={[styles.bar, { backgroundColor: theme.bgSidebar }]}>
          {editing ? (
            <Pencil color={theme.muted} size={15} />
          ) : (
            <Reply color={theme.muted} size={15} />
          )}
          <Text style={[styles.barText, { color: theme.muted }]} numberOfLines={1}>
            {editing ? (
              '메시지 고치는 중'
            ) : (
              <>
                <Text style={{ color: theme.fg, fontWeight: '700' }}>
                  {displayName(replyTo!.author)}
                </Text>
                님에게 답장{' '}
                {replyTo!.content
                  ? markdownToPlain(replyTo!.content)
                  : `첨부 ${replyTo!.attachments.length}개`}
              </>
            )}
          </Text>
          <Pressable
            onPress={editing ? onCancelEdit : onCancelReply}
            hitSlop={10}
            accessibilityLabel={editing ? '고치기 취소' : '답장 취소'}
          >
            <X color={theme.muted} size={18} />
          </Pressable>
        </View>
      )}

      {!editing && drafts.drafts.length > 0 && (
        <ScrollView
          horizontal
          contentContainerStyle={styles.drafts}
          keyboardShouldPersistTaps="handled"
        >
          {drafts.drafts.map((d) => (
            <DraftTile
              key={d.localId}
              draft={d}
              onRemove={() => drafts.remove(d.localId)}
              onRetry={() => drafts.retry(d.localId)}
            />
          ))}
        </ScrollView>
      )}
      {!editing && drafts.notice && (
        <Text style={[styles.notice, { color: theme.warn }]}>{drafts.notice}</Text>
      )}

      <View style={styles.inputRow}>
        {!editing && (
          <Pressable
            onPress={() => setAttachMenu(true)}
            style={[styles.round, { backgroundColor: theme.bgInput }]}
            accessibilityLabel="첨부"
            hitSlop={4}
          >
            <Plus color={theme.muted} size={22} />
          </Pressable>
        )}
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            if (value) onTyping();
          }}
          placeholder={placeholder}
          placeholderTextColor={theme.muted}
          multiline
          maxLength={MESSAGE_MAX_LENGTH}
          autoFocus={editing}
          style={[styles.input, { color: theme.fg, backgroundColor: theme.bgInput }]}
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[styles.round, { backgroundColor: canSend ? theme.accent : theme.bgInput }]}
          accessibilityLabel={editing ? '저장' : '보내기'}
          hitSlop={4}
        >
          <SendHorizontal color={canSend ? theme.accentFg : theme.muted} size={20} />
        </Pressable>
      </View>

      <Sheet visible={attachMenu} title="첨부" onClose={() => setAttachMenu(false)}>
        <AttachOption icon={ImageIcon} label="사진" onPress={() => void attach(pickImages)} />
        <AttachOption icon={Paperclip} label="파일" onPress={() => void attach(pickFiles)} />
      </Sheet>
    </View>
  );
}

function AttachOption({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof ImageIcon;
  label: string;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: theme.bgHover }]}
    >
      <Icon color={theme.muted} size={22} />
      <Text style={{ color: theme.fg, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function DraftTile({
  draft,
  onRemove,
  onRetry,
}: {
  draft: AttachmentDraft;
  onRemove(): void;
  onRetry(): void;
}) {
  const theme = useTheme();
  const failed = draft.status === 'failed';
  return (
    <Pressable
      onPress={failed ? onRetry : undefined}
      style={[
        styles.draft,
        { backgroundColor: theme.bgSidebar, borderColor: failed ? theme.danger : theme.border },
      ]}
      accessibilityLabel={failed ? `${draft.file.name} 다시 올리기` : draft.file.name}
    >
      {draft.file.isImage ? (
        <Image
          source={{ uri: draft.file.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : (
        <View style={styles.draftFile}>
          <FileIcon color={theme.muted} size={22} />
          <Text style={{ color: theme.fg, fontSize: 11 }} numberOfLines={2}>
            {draft.file.name}
          </Text>
        </View>
      )}
      {draft.status === 'uploading' && (
        <View style={[styles.progressTrack, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
          <View
            style={[
              styles.progress,
              { width: `${Math.round(draft.progress * 100)}%`, backgroundColor: theme.accent },
            ]}
          />
        </View>
      )}
      {failed && <Text style={[styles.failed, { backgroundColor: theme.danger }]}>다시</Text>}
      <Pressable onPress={onRemove} hitSlop={8} style={styles.remove} accessibilityLabel="빼기">
        <X color="#fff" size={14} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 8 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  barText: { flex: 1, fontSize: 13 },
  drafts: { gap: 8, paddingHorizontal: 10 },
  draft: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  draftFile: { flex: 1, padding: 6, gap: 4, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
  progress: { height: 4 },
  failed: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    color: '#fff',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 2,
  },
  remove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  notice: { fontSize: 12, marginHorizontal: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10 },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 15,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 50,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
});
