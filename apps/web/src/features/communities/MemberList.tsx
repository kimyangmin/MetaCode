import type { CommunityMember } from '@metacode/shared';
import { usePresenceStore } from '../../stores/presence';
import { openProfile } from '../../stores/profile';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '../../ui/format';
import { useCommunities, useMembers } from './hooks';
import { memberColor, roleNames } from './roles';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;

/** 커뮤니티 화면 오른쪽: 온라인/오프라인 멤버. 누르면 사용자 정보(메시지 보내기 포함)를 띄운다. */
export function MemberList({ communityId }: { communityId: string }) {
  const members = useMembers(communityId);
  const online = usePresenceStore((s) => s.online);
  const roles = useCommunities().data?.find((c) => c.id === communityId)?.roles ?? [];

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
                  onClick={(e) => openProfile(m.user, e, communityId)}
                  title={`${displayName(m.user)} 정보`}
                >
                  <Avatar user={m.user} size={32} showStatus />
                  <span
                    className="members__name"
                    style={{ color: memberColor(m.roleIds, roles) ?? undefined }}
                    title={roleNames(m.roleIds, roles).join(', ') || undefined}
                  >
                    {displayName(m.user)}
                  </span>
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
