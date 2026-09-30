import { describe, expect, it } from 'vitest';
import { REPLY_DISTANCE, replyPull, shouldReply } from './swipeReply';

describe('메시지 밀어 답장하기', () => {
  it('답장 거리까지는 손가락을 그대로 따라오고, 그 뒤로는 덜 따라오다 멈춘다', () => {
    expect(replyPull(-30)).toBe(0);
    expect(replyPull(30)).toBe(30);
    expect(replyPull(REPLY_DISTANCE)).toBe(REPLY_DISTANCE);
    const beyond = replyPull(REPLY_DISTANCE + 40);
    expect(beyond).toBeGreaterThan(REPLY_DISTANCE);
    expect(beyond).toBeLessThan(REPLY_DISTANCE + 40);
    expect(replyPull(1000)).toBe(replyPull(2000));
  });

  it('답장 거리 넘게 오른쪽으로 밀어야 답장한다', () => {
    expect(shouldReply(REPLY_DISTANCE)).toBe(true);
    expect(shouldReply(REPLY_DISTANCE - 1)).toBe(false);
    expect(shouldReply(-100)).toBe(false);
  });
});
