import { useEditorStore } from '../../stores/editor';
import { PixelEditorScreen } from './PixelEditorScreen';

/** 도트 에디터를 앱 화면 전체 위에 띄운다 (설정·커뮤니티 설정 어디서 열어도). 화면에 하나만 */
export function EditorHost() {
  const target = useEditorStore((s) => s.target);
  if (!target) return null;
  return (
    <PixelEditorScreen
      key={target.mode === 'edit' ? target.asset.id : 'new'}
      target={target}
      onClose={() => useEditorStore.setState({ target: null })}
    />
  );
}
