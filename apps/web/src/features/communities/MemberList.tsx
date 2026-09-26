import type { CommunityMember } from '@metacode/shared';
import { usePresenceStore } from '../../stores/presence';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { useMeRequired, useMembers, useOpenDm } from './hooks';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;

/** 커뮤니티 화면 오른쪽: 온라인/오프라인 멤버. 누르면 DM을 연다. */
export function MemberList({ communityId }: { communityId: string }) {
  const members = useMembers(communityId);
  const online = usePresenceStore((s) => s.online);
  const me = useMeRequired();
  const openDm = useOpenDm();

  if (!members.data) return <aside className="members" aria-label="멤버" />;

  const isOnline = (m: CommunityMember) => online[m.user.id] ?? m.online;
  const groups = [
    { label: '온라인', list: members.data.filter(isOnline) },
    { label: '오프라인', list: members.data.filter((m) => !isOnline(m)) },
  ];

  return (
    <aside className="members" aria-label="멤버">
      {groups.map(
        (group) =>
          group.list.length > 0 && (
            <section key={group.label}>
              <h3 className="members__section">
                {group.label} — {group.list.length}
              </h3>
              {group.list.map((m) => (
                <button
                  key={m.user.id}
                  className="members__item"
                  data-online={isOnline(m)}
                  disabled={m.user.id === me.id}
                  onClick={() => void openDm([m.user.id])}
                  title={
                    m.user.id === me.id ? undefined : `${displayName(m.user)}님에게 메시지 보내기`
                  }
                >
                  <Avatar user={m.user} size={32} showStatus />
                  <span className="members__name">{displayName(m.user)}</span>
                  {ROLE_LABEL[m.role] && (
                    <span className="members__role">{ROLE_LABEL[m.role]}</span>
                  )}
                </button>
              ))}
            </section>
          ),
      )}
    </aside>
  );
}
