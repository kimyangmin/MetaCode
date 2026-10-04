import type { AttachmentDto } from '@metacode/shared';
import { Image } from 'expo-image';
import { Download, X } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatBytes, openAttachment, useAttachmentLink } from './attachments';

/** 이미지 크게 보기 (웹 Lightbox): 원본을 화면에 맞춰 보여 주고 받기 버튼. 누르거나 뒤로 가기로 닫는다 */
export function Lightbox({ image, onClose }: { image: AttachmentDto | null; onClose(): void }) {
  return (
    <Modal visible={image !== null} transparent animationType="fade" onRequestClose={onClose}>
      {image && <LightboxBody image={image} onClose={onClose} />}
    </Modal>
  );
}

function LightboxBody({ image, onClose }: { image: AttachmentDto; onClose(): void }) {
  const insets = useSafeAreaInsets();
  const link = useAttachmentLink(image.id, 'original');
  return (
    <View style={styles.root}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기">
        {link.data ? (
          <Image
            source={{ uri: link.data.url, cacheKey: `attachment:${image.id}:o` }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
          />
        ) : (
          <ActivityIndicator color="#fff" style={styles.loading} />
        )}
      </Pressable>
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="닫기" style={styles.button}>
          <X color="#fff" size={24} />
        </Pressable>
        <View style={styles.names}>
          <Text style={styles.name} numberOfLines={1}>
            {image.fileName}
          </Text>
          <Text style={styles.meta}>
            {formatBytes(image.size)}
            {image.width && image.height ? ` · ${image.width}×${image.height}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => void openAttachment(image).catch(() => undefined)}
          hitSlop={10}
          accessibilityLabel="받기"
          style={styles.button}
        >
          <Download color="#fff" size={22} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  loading: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  button: { padding: 8 },
  names: { flex: 1, minWidth: 0 },
  name: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#c9d1d9', fontSize: 12 },
});
