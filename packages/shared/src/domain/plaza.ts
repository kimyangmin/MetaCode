import { type ChannelRef, isDmChannel } from './channel.js';

export const PlazaMap = {
  FountainSquare: 'fountain-square',
  Campfire: 'campfire',
  /** 횡스크롤 커뮤니티의 분수 광장 (옆에서 본 광장) */
  FountainSide: 'fountain-side',
} as const;

export type PlazaMap = (typeof PlazaMap)[keyof typeof PlazaMap];

/**
 * 광장 방식. 탑다운은 위에서 내려다보며 네 방향으로 걷고, 횡스크롤은 옆에서 보며 좌우로 걷고 점프한다.
 * 커뮤니티를 만들 때 고르고(커뮤니티 설정에서 바꿀 수 있음), DM 모닥불 캠프는 늘 탑다운이다.
 */
export const PlazaStyle = {
  TopDown: 'TOP_DOWN',
  SideScroll: 'SIDE_SCROLL',
} as const;

export type PlazaStyle = (typeof PlazaStyle)[keyof typeof PlazaStyle];

export const PLAZA_STYLES: readonly PlazaStyle[] = [PlazaStyle.TopDown, PlazaStyle.SideScroll];

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

/** 광장의 내장 맵. 커뮤니티 광장은 광장 방식에 따라 분수 광장(탑다운) 또는 옆에서 본 분수 광장 */
export function getPlazaMap(plazaId: PlazaId, style: PlazaStyle = PlazaStyle.TopDown): PlazaMap {
  if (plazaId.startsWith('dm:')) return PlazaMap.Campfire;
  return style === PlazaStyle.SideScroll ? PlazaMap.FountainSide : PlazaMap.FountainSquare;
}
