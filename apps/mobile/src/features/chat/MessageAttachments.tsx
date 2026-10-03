import type { AttachmentDto } from '@metacode/shared';
import { Image } from 'expo-image';
import { Download, File as FileIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ApiError } from '../../api/client';
import { useTheme } from '../../ui/theme';
import { Lightbox } from './Lightbox';
import { formatBytes, openAttachment, useAttachmentLink } from './attachments';

/** 목록의 이미지 칸 최대 크기 (웹 IMAGE_BOX 320×240, 화면이 좁으면 본문 폭에 맞춰 줄어듦) */
const IMAGE_BOX = { width: 320, height: 240 };
/** 이 크기 이하의 GIF는 목록에서 원본을 틀어 움직이게 한다 (웹과 같음) */
const GIF_INLINE_MAX_BYTES = 15 * 1024 * 1024;

export function MessageAttachments({ attachments }: { attachments: AttachmentDto[] }) {
  const [viewing, setViewing] = useState<AttachmentDto | null>(null);
  const images = attachments.filter((a) => a.kind === 'image');
  const files = attachments.filter((a) => a.kind === 'file');
  return (
    <View style={styles.root}>
      {images.length > 0 && (
        <View style={styles.images}>
          {images.map((image) => (
            <ImageTile key={image.id} image={image} onPress={() => setViewing(image)} />
          ))}
        </View>
      )}
      {files.map((file) => (
        <FileCard key={file.id} file={file} />
      ))}
      <Lightbox image={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

function ImageTile({ image, onPress }: { image: AttachmentDto; onPress(): void }) {
  const theme = useTheme();
  const { width: screen } = useWindowDimensions();
  // 아바타 칸(64) + 오른쪽 여백(16)을 뺀 본문 폭보다 넓어지지 않게
  const maxWidth = Math.min(IMAGE_BOX.width, screen - 80);
  const ratio = image.width && image.height ? image.width / image.height : 4 / 3;
  let width = Math.min(maxWidth, image.width ?? maxWidth);
  let height = width / ratio;
  if (height > IMAGE_BOX.height) {
    height = IMAGE_BOX.height;
    width = height * ratio;
  }
  const animated = image.contentType === 'image/gif' && image.size <= GIF_INLINE_MAX_BYTES;
  const link = useAttachmentLink(image.id, animated ? 'original' : 'thumbnail');
  return (
    <Pressable
      onPress={onPress}
      style={[styles.image, { width, height, backgroundColor: theme.bgActive }]}
      accessibilityLabel={image.fileName}
    >
      {link.data && (
        <Image
          source={{
            uri: link.data.url,
            cacheKey: `attachment:${image.id}:${animated ? 'o' : 't'}`,
          }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
        />
      )}
      {image.contentType === 'image/gif' && !animated && <Text style={styles.badge}>GIF</Text>}
    </Pressable>
  );
}

function FileCard({ file }: { file: AttachmentDto }) {
  const theme = useTheme();
  const open = () =>
    void openAttachment(file).catch((e: unknown) =>
      Alert.alert('받지 못했습니다', e instanceof ApiError ? e.message : '다시 시도해 주세요.'),
    );
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [
        styles.file,
        {
          backgroundColor: pressed ? theme.bgHover : theme.bgSidebar,
          borderColor: theme.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${file.fileName} 받기`}
    >
      <FileIcon color={theme.muted} size={26} />
      <View style={styles.fileInfo}>
        <Text style={{ color: theme.accent, fontSize: 14 }} numberOfLines={1}>
          {file.fileName}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>{formatBytes(file.size)}</Text>
      </View>
      <Download color={theme.muted} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6, marginTop: 4 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  image: { borderRadius: 8, overflow: 'hidden' },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileInfo: { flex: 1, minWidth: 0 },
});
