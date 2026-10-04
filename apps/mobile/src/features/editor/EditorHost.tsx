import { useEditorStore } from '../../stores/editor';
import { MapEditorScreen } from './MapEditorScreen';
import { PixelEditorScreen } from './PixelEditorScreen';

/** 도트 에디터·맵 에디터를 앱 화면 전체 위에 띄운다 (설정·커뮤니티 설정 어디서 열어도). 화면에 하나씩 */
export function EditorHost() {
  const target = useEditorStore((s) => s.target);
  const map = useEditorStore((s) => s.map);
  return (
    <>
      {map && (
        <MapEditorScreen
          key={map.communityId}
          target={map}
          onClose={() => useEditorStore.setState({ map: null })}
        />
      )}
      {target && (
        <PixelEditorScreen
          key={target.mode === 'edit' ? target.asset.id : 'new'}
          target={target}
          onClose={() => useEditorStore.setState({ target: null })}
        />
      )}
    </>
  );
}
