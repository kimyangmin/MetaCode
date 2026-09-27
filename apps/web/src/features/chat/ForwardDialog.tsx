import { type MessageDto, SocketEvent } from '@metacode/shared';
import { useMemo, useState } from 'react';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { Dialog } from '../../ui/Dialog';
import { dmTitle } from '../../ui/format';
import { useCommunities, useDms, useMeRequired } from '../communities/hooks';

interface Destination {
  id: string;
  label: string;
  place: string;
}

/** 메시지 전달: 볼 수 있는 텍스트 채널과 DM 중에서 고른다. 첨부도 함께 전달된다 */
export function ForwardDialog({ message, onClose }: { message: MessageDto; onClose(): void }) {
  const { socket } = useRealtime();
  const me = useMeRequired();
  const communities = useCommunities();
  const dms = useDms();
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destinations = useMemo<Destination[]>(() => {
    const channels = (communities.data ?? []).flatMap((c) =>
      c.channels
        .filter((ch) => ch.type === 'TEXT')
        .map((ch) => ({ id: ch.id, label: `# ${ch.name}`, place: c.name })),
    );
    const direct = (dms.data ?? []).map((dm) => ({
      id: dm.id,
      label: `@ ${dmTitle(dm, me.id)}`,
      place: '다이렉트 메시지',
    }));
    return [...channels, ...direct].filter((d) => d.id !== message.channelId);
  }, [communities.data, dms.data, me.id, message.channelId]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? destinations.filter((d) => `${d.label} ${d.place}`.toLowerCase().includes(q))
    : destinations;

  const send = async (destination: Destination) => {
    if (!socket) return;
    setSending(destination.id);
    setError(null);
    const ack = await socket
      .timeout(10_000)
      .emitWithAck(SocketEvent.MessageForward, {
        messageId: message.id,
        channelId: destination.id,
      })
      .catch(() => ({ ok: false as const, error: '메시지를 전달하지 못했습니다.' }));
    setSending(null);
    if (ack.ok) onClose();
    else setError(ack.error);
  };

  return (
    <Dialog title="메시지 전달" onClose={onClose}>
      <div className="form">
        <blockquote className="forward-preview">
          {message.content || `📎 파일 ${message.attachments.length}개`}
        </blockquote>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="채널이나 대화 찾기"
          aria-label="보낼 곳 찾기"
        />
        <ul className="forward-list">
          {shown.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="forward-list__item"
                disabled={sending !== null}
                onClick={() => void send(d)}
              >
                <span>{d.label}</span>
                <small>{d.place}</small>
                {sending === d.id && <em>보내는 중…</em>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="form__hint">보낼 곳이 없습니다.</li>}
        </ul>
        {error && <p className="form__error">{error}</p>}
      </div>
    </Dialog>
  );
}
