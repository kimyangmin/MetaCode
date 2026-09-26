export const ChannelType = {
  Text: 'TEXT',
  Voice: 'VOICE',
  Dm: 'DM',
  GroupDm: 'GROUP_DM',
} as const;

export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

/** 커뮤니티 채널(TEXT, VOICE)이면 communityId가 있고, DM이면 null이다. */
export type ChannelRef =
  | { id: string; type: typeof ChannelType.Text | typeof ChannelType.Voice; communityId: string }
  | { id: string; type: typeof ChannelType.Dm | typeof ChannelType.GroupDm; communityId: null };

export function isDmChannel(type: ChannelType): boolean {
  return type === ChannelType.Dm || type === ChannelType.GroupDm;
}
