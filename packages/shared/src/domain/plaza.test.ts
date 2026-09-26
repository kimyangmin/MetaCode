import { describe, expect, it } from 'vitest';
import { ChannelType } from './channel.js';
import { PlazaMap, getPlazaId, getPlazaMap } from './plaza.js';

describe('getPlazaId', () => {
  it('커뮤니티의 텍스트/음성 채널은 같은 커뮤니티 광장을 공유한다', () => {
    const text = getPlazaId({ id: 'c1', type: ChannelType.Text, communityId: 'team' });
    const voice = getPlazaId({ id: 'c2', type: ChannelType.Voice, communityId: 'team' });

    expect(text).toBe('community:team');
    expect(voice).toBe('community:team');
  });

  it('DM과 그룹 DM은 채널마다 광장을 가진다', () => {
    expect(getPlazaId({ id: 'd1', type: ChannelType.Dm, communityId: null })).toBe('dm:d1');
    expect(getPlazaId({ id: 'g1', type: ChannelType.GroupDm, communityId: null })).toBe('dm:g1');
  });
});

describe('getPlazaMap', () => {
  it('커뮤니티 광장은 분수 광장, DM 광장은 모닥불 캠프다', () => {
    expect(getPlazaMap('community:team')).toBe(PlazaMap.FountainSquare);
    expect(getPlazaMap('dm:d1')).toBe(PlazaMap.Campfire);
  });
});
