import {
  type PlazaOccupant,
  PlazaMap,
  type UserProfile,
  isGrounded,
  spawnPosition,
} from '@metacode/shared';
import { BUILTIN_LAYOUTS, BUILTIN_MAPS, builtinAsset } from '@metacode/shared/builtin-assets';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTERPOLATION_DELAY_MS } from './motion.js';
import { type MoveState, PlazaWorld } from './world.js';

const user = (id: string): UserProfile => ({
  id,
  username: id,
  displayName: null,
  avatarUrl: '',
  character: null,
});

function occupant(id: string, map: PlazaMap): PlazaOccupant {
  const position = spawnPosition(BUILTIN_LAYOUTS[map], id);
  return { user: user(id), ...position, dir: 'down', moving: false, motion: null };
}

function world(map: PlazaMap, ids = ['me', 'bob']) {
  const moves: MoveState[] = [];
  const motions: (string | null)[] = [];
  const plaza = new PlazaWorld({
    meId: 'me',
    builtinAsset,
    onMove: (state) => moves.push(state),
    onMotion: (motion) => motions.push(motion),
  });
  plaza.applySnapshot({
    plazaId: 'dm:c1',
    map,
    theme: 'default',
    definition: BUILTIN_MAPS[map],
    assets: [],
    occupants: ids.map((id) => occupant(id, map)),
  });
  plaza.resize(400, 300);
  return { plaza, moves, motions };
}

/** performance.now()를 손으로 옮기며 프레임을 돌린다 */
function run(plaza: PlazaWorld, ms: number, control?: Parameters<PlazaWorld['update']>[2]) {
  for (let t = 0; t < ms; t += 16) {
    vi.advanceTimersByTime(16);
    plaza.update(performance.now(), 16, control);
  }
}

describe('광장 월드', () => {
  afterEach(() => vi.useRealTimers());

  it('스냅숏으로 맵과 인원을 두고, 작은 맵은 맵 전체가 들어오는 배율', () => {
    const { plaza } = world(PlazaMap.Campfire);
    expect(plaza.actors.size).toBe(2);
    expect(plaza.me?.isMe).toBe(true);
    expect(plaza.zoom).toBeGreaterThanOrEqual(1);
    // 캠프(16×12타일 안팎)가 400×300에 들어가는 가장 큰 정수 배율
    expect(plaza.layout!.width * 16 * plaza.zoom).toBeLessThanOrEqual(400);
  });

  it('방향 입력으로 걷고, 움직이는 동안 일정 간격으로 보내다 멈춘 자리를 보낸다', () => {
    vi.useFakeTimers();
    const { plaza, moves } = world(PlazaMap.FountainSquare);
    const start = { ...plaza.me!.position };
    run(plaza, 500, { dx: 1, dy: 0, jump: false, jumpHeld: false, drop: false });
    expect(plaza.me!.position.x).toBeGreaterThan(start.x);
    expect(plaza.me!.dir).toBe('right');
    // 100ms 간격으로 보낸다 (걷다 막혀 멈추면 그때 한 번 더)
    expect(moves.length).toBeGreaterThanOrEqual(3);
    expect(moves[0]!.moving).toBe(true);
    run(plaza, 200);
    expect(moves.at(-1)!.moving).toBe(false);
  });

  it('누른 곳으로 길을 찾아 걸어가고, 도착하면 표시를 지운다', () => {
    vi.useFakeTimers();
    const { plaza } = world(PlazaMap.FountainSquare);
    const from = plaza.me!.position;
    const target = { x: from.x + 48, y: from.y };
    plaza.walkTo(target);
    expect(plaza.marker).not.toBeNull();
    run(plaza, 3000);
    expect(Math.abs(plaza.me!.position.x - target.x)).toBeLessThan(16);
    expect(plaza.marker).toBeNull();
  });

  it('다른 사람은 받은 위치를 늦게 따라가며 걷는 모습', () => {
    vi.useFakeTimers();
    const { plaza } = world(PlazaMap.FountainSquare);
    const bob = plaza.actors.get('bob')!;
    const from = { ...bob.position };
    plaza.moved({
      plazaId: 'dm:c1',
      userId: 'bob',
      x: from.x + 10,
      y: from.y,
      dir: 'right',
      moving: true,
    });
    run(plaza, INTERPOLATION_DELAY_MS + 100);
    expect(bob.position.x).toBeCloseTo(from.x + 10);
    expect(bob.dir).toBe('right');
  });

  it('첨부 메시지는 첨부 모션이 없으면 제자리에서 뛰고, 말풍선은 시간이 지나면 내린다', () => {
    vi.useFakeTimers();
    const { plaza } = world(PlazaMap.Campfire);
    const now = performance.now();
    plaza.say('bob', {
      id: 'm1',
      label: null,
      text: '🖼️ 1',
      kind: 'attachment-emote',
      icon: 'image',
      expiresAt: now + 1000,
    });
    run(plaza, 100);
    const bob = plaza.actors.get('bob')!;
    expect(bob.bubbles).toHaveLength(1);
    expect(bob.hopUntil > performance.now() || bob.emoteUntil > performance.now()).toBe(true);
    run(plaza, 1200);
    expect(bob.bubbles).toHaveLength(0);
  });

  it('횡스크롤: 점프하면 공중에 떴다가 다시 땅에 선다', () => {
    vi.useFakeTimers();
    const { plaza, moves } = world(PlazaMap.FountainSide);
    run(plaza, 100);
    const ground = plaza.me!.position.y;
    run(plaza, 16, { dx: 0, dy: 0, jump: true, jumpHeld: true, drop: false });
    run(plaza, 150, { dx: 0, dy: 0, jump: false, jumpHeld: true, drop: false });
    expect(plaza.me!.position.y).toBeLessThan(ground);
    expect(plaza.me!.airborne).toBe(true);
    run(plaza, 1500);
    expect(plaza.me!.position.y).toBeCloseTo(ground);
    expect(isGrounded(plaza.layout!, plaza.me!.position.x, plaza.me!.position.y)).toBe(true);
    // 뛰어오른 순간과 내려앉은 순간은 간격과 상관없이 보냈다
    expect(moves.length).toBeGreaterThanOrEqual(2);
  });

  it('카메라는 작은 맵이면 맵 가운데, 넓은 맵이면 내 캐릭터 근처', () => {
    const camp = world(PlazaMap.Campfire).plaza;
    const center = camp.cameraCenter();
    expect(center.x).toBe((camp.layout!.width * 16) / 2);
    const square = world(PlazaMap.FountainSquare).plaza;
    const me = square.me!.position;
    expect(Math.abs(square.cameraCenter().x - me.x)).toBeLessThan(400 / square.zoom);
  });
});
