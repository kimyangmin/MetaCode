import { type DragEvent, useState } from 'react';
import { reorder } from './reorder';

/** 드래그 중인 항목을 다른 목록(파일 끌어 놓기 등)과 구분하는 데이터 형식 */
const SORT_TYPE = 'application/x-metacode-sort';

/**
 * 끌어서 순서 바꾸기. 항목에 itemProps(id)를 펼쳐 넣으면 된다.
 * 놓을 자리는 항목의 위쪽 절반이면 앞, 아래쪽 절반이면 뒤이고, data-drop으로 표시한다.
 */
export function useDragSort(ids: string[], onReorder: (ids: string[]) => void, enabled = true) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const reset = () => {
    setDragId(null);
    setOver(null);
  };

  const itemProps = (id: string) => {
    if (!enabled) return {};
    return {
      draggable: true,
      'data-dragging': dragId === id || undefined,
      'data-drop': over?.id === id && dragId !== id ? (over.after ? 'after' : 'before') : undefined,
      onDragStart: (e: DragEvent) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(SORT_TYPE, id);
      },
      onDragOver: (e: DragEvent) => {
        // 이 목록의 항목을 끌 때만 받는다.
        if (!dragId || !ids.includes(dragId)) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        if (over?.id !== id || over.after !== after) setOver({ id, after });
      },
      onDrop: (e: DragEvent) => {
        if (!dragId || !over) return;
        e.preventDefault();
        const next = reorder(ids, dragId, over.id, over.after);
        if (next.some((value, i) => value !== ids[i])) onReorder(next);
        reset();
      },
      onDragEnd: reset,
    };
  };

  return { itemProps, dragging: dragId !== null };
}
