import { type ChannelRef, isDmChannel } from './channel.js';

export const PlazaMap = {
  FountainSquare: 'fountain-square',
  Campfire: 'campfire',
} as const;

export type PlazaMap = (typeof PlazaMap)[keyof typeof PlazaMap];

export const DEFAULT_THEME = 'default';

/** `community:<communityId>` 또는 `dm:<channelId>` */
export type PlazaId = `community:${string}` | `dm:${string}`;

/**
 * 채널이 속한 광장. 커뮤니티의 텍스트/음성 채널은 모두 커뮤니티 광장 하나를 공유하고,
 * DM과 그룹 DM은 채널마다 광장을 하나씩 가진다.
 */
export function getPlazaId(channel: ChannelRef): PlazaId {
  return isDmChannel(channel.type) ? `dm:${channel.id}` : `community:${channel.communityId}`;
}

export function getPlazaMap(plazaId: PlazaId): PlazaMap {
  return plazaId.startsWith('dm:') ? PlazaMap.Campfire : PlazaMap.FountainSquare;
}
