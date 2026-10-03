import {
  type AnimatorRuntime,
  AnimatorParamType,
  type AssetManifest,
  type AssetRef,
  CHARACTER_WORLD_HEIGHT,
  type Direction,
  MOVE_SEND_INTERVAL_MS,
  type MapDefinition,
  type MapLayout,
  type PlazaCorrection,
  type PlazaMoved,
  type PlazaOccupant,
  type PlazaSnapshot,
  PlazaStyle,
  type Position,
  TILE_SIZE,
  type UserProfile,
  animatorLocksMovement,
  buildCollision,
  characterFor,
  characterMotions,
  characterWorldSize,
  fireTrigger,
  groundBelow,
  isGrounded,
  isWalkable,
  mapStyle,
  setAnimatorBool,
  startAnimator,
  stepAnimator,
} from '@metacode/shared';
import { type Bubble, activeBubbles, pushBubble } from './bubbles.js';
import { stepZoomOffset, zoomFor } from './camera.js';
import { type AssetLookup, type CharacterLook, resolveCharacterLook } from './character.js';
import { RemoteTrack, directionOf, stepByInput, stepToward } from './motion.js';
import { findPath, tileCenter } from './pathfinding.js';
import {
  ATTACHMENT_HOP_MS,
  type CharacterPose,
  type PlayingMotion,
  airbornePose,
  animationName,
  animatorCycleMs,
  animatorPose,
  characterPose,
  emoteDurationMs,
  motionDurationMs,
} from './pose.js';
import { type SideBody, createSideBody, stepSide } from './sideMotion.js';
import type { ActorVoice } from './voice.js';

/*
 * 광장 하나의 상태 (그리는 쪽과 상관없음): 맵 충돌 격자, 광장 인원의 캐릭터, 내 캐릭터 이동(방향 입력, 누른 곳으로
 * 걸어가기), 다른 사람 위치 보간, 모션·애니메이터, 말풍선, 카메라. 네이티브 앱은 update() 뒤에 actors를 읽어
 * Skia로 그린다. 서버와의 통신은 화면 쪽이 하고 여기에는 결과만 넣는다 (웹 PlazaScene과 같은 규칙).
 */

/** 이만큼 움직이지 않아야 걷기를 멈춘다 (받은 위치 사이에서 걷기 모션이 끊겼다 이어지지 않게) */
const WALK_HOLD_MS = 120;
/** 서버가 받아 주는 모션 요청 간격 (이보다 잦으면 버린다) + 여유 */
const MOTION_SEND_GAP_MS = 170;
/** 횡스크롤 클릭 이동: 막혀서 이만큼 못 가면 그만둔다 */
const SIDE_STUCK_MS = 1500;
/** 횡스크롤 클릭 이동: 누른 곳이 위(발판)면 제자리에서 이만큼까지 뛰어 오른다 */
const SIDE_TARGET_JUMPS = 3;

export interface MoveState extends Position {
  dir: Direction;
  moving: boolean;
}

/** 내 캐릭터 조작 (한 프레임). 방향은 -1~1 (조이스틱은 기울인 방향, 크기는 보지 않음) */
export interface PlazaControl {
  dx: number;
  dy: number;
  /** 이번 프레임에 점프를 눌렀다 (횡스크롤) */
  jump: boolean;
  /** 점프를 누르고 있다 (일찍 떼면 낮게 뛴다) */
  jumpHeld: boolean;
  /** 이번 프레임에 아래를 눌렀다: 발판에서 내려간다 (횡스크롤) */
  drop: boolean;
}

export const NO_CONTROL: PlazaControl = { dx: 0, dy: 0, jump: false, jumpHeld: false, drop: false };

export interface PlazaWorldOptions {
  meId: string;
  /** 내장 에셋 (@metacode/shared/builtin-assets). 기본 export에 넣지 않아서 화면 쪽이 넘긴다 */
  builtinAsset: AssetLookup;
  /** 내 캐릭터 위치를 서버에 보낸다 */
  onMove(state: MoveState): void;
  /** 내 캐릭터 모션을 틀거나(이름) 멈췄다(null): 서버에 보낸다 */
  onMotion(motion: string | null, loop: boolean): void;
  /** 처음 배율 단계 (사용자가 바꾼 값, 기억해 둔 것) */
  zoomOffset?: number;
}

export interface WorldActor {
  user: UserProfile;
  isMe: boolean;
  look: CharacterLook;
  /** 광장에서 그릴 크기 (월드 px, 발밑 가운데 기준) */
  size: { width: number; height: number };
  /** 지금 틀고 있는 애니메이션과 시작 시각 */
  animation: { name: string; start: number };
  position: Position;
  dir: Direction;
  /** 다른 사람: 받은 위치 기록. 나는 없음 */
  track: RemoteTrack | null;
  /** 이번 프레임에 움직였는지 (내 캐릭터는 서버에 보내는 moving) */
  walking: boolean;
  /** 횡스크롤: 땅에서 떨어져 있다 (점프, 떨어지는 중) */
  airborne: boolean;
  airborneSince: number;
  lastY: number;
  lastMovedAt: number;
  bubbles: Bubble[];
  /** 첨부 모션이 끝나는 시각 */
  emoteUntil: number;
  /** 첨부 모션이 없는 캐릭터가 제자리에서 뛰는 것이 끝나는 시각 */
  hopUntil: number;
  motion: (PlayingMotion & { start: number }) | null;
  animator: AnimatorRuntime | null;
  voice: ActorVoice | null;
  // ── update()가 정하는 그리기 값 ──
  pose: CharacterPose;
  /** 제자리에서 뛰는 높이 (px) */
  lift: number;
  /** 그림자·말하는 중 고리를 둘 y (횡스크롤은 발 아래 땅) */
  groundY: number;
  /** 그림자·고리의 진하기 (횡스크롤은 높이 뜰수록 옅게) */
  groundAlpha: number;
}

/** 누른 곳 표시 (탑다운은 길 끝, 횡스크롤은 그 아래 땅) */
export interface WorldMarker extends Position {}

export class PlazaWorld {
  private readonly options: PlazaWorldOptions;
  definition: MapDefinition | null = null;
  layout: MapLayout | null = null;
  style: PlazaStyle = PlazaStyle.TopDown;
  /** 맵에 쓴 커뮤니티 에셋 버전 (맵을 다시 그릴지 가린다) */
  mapKey = '';
  readonly actors = new Map<string, WorldActor>();
  marker: WorldMarker | null = null;
  /** 지금 배율 (월드 px → 화면 단위) */
  zoom = 3;
  private zoomOffset: number;
  private view = { width: 0, height: 0 };

  private readonly customAssets = new Map<AssetRef, AssetManifest>();
  readonly assetOf: AssetLookup = (ref) =>
    this.customAssets.get(ref) ?? this.options.builtinAsset(ref);
  private path: Position[] = [];
  private body: SideBody | null = null;
  private sideTarget: {
    x: number;
    groundY: number;
    blocked: boolean;
    progressAt: number;
    jumps: number;
  } | null = null;
  private voice: ReadonlyMap<string, ActorVoice> = new Map();
  private lastSent: (MoveState & { at: number }) | null = null;
  private readonly heldMotions = new Map<string, { name: string; at: number }>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: PlazaWorldOptions) {
    this.options = options;
    this.zoomOffset = options.zoomOffset ?? 0;
  }

  get meId(): string {
    return this.options.meId;
  }

  get side(): boolean {
    return this.style === PlazaStyle.SideScroll;
  }

  // ── 서버에서 받은 것 반영 ──

  /** 받아 온 에셋을 등록한다 (직접 그린 캐릭터, 맵에 쓴 커뮤니티 에셋). 그 뒤 updateUser()로 다시 그린다 */
  addAsset(ref: AssetRef, manifest: AssetManifest): void {
    this.customAssets.set(ref, manifest);
  }

  /** 광장을 (다시) 열었을 때: 맵을 정하고 인원을 전부 새로 둔다. 맵 에셋은 먼저 addAsset()으로 등록한다 */
  applySnapshot(snapshot: PlazaSnapshot): void {
    this.definition = snapshot.definition;
    this.mapKey = JSON.stringify(snapshot.definition) + JSON.stringify(snapshot.assets);
    this.style = mapStyle(snapshot.definition);
    this.layout = buildCollision(snapshot.definition, this.assetOf);
    this.actors.clear();
    this.path = [];
    this.body = null;
    this.sideTarget = null;
    this.marker = null;
    this.lastSent = null;
    for (const occupant of snapshot.occupants) this.upsert(occupant);
    this.updateZoom();
  }

  upsert(occupant: PlazaOccupant): void {
    if (this.actors.has(occupant.user.id)) {
      this.updateUser(occupant.user);
      return;
    }
    const now = performance.now();
    const look = this.lookOf(occupant.user);
    const isMe = occupant.user.id === this.options.meId;
    const position = { x: occupant.x, y: occupant.y };
    const actor: WorldActor = {
      user: occupant.user,
      isMe,
      look,
      size: sizeOf(look.manifest),
      animation: { name: `idle-${occupant.dir}`, start: 0 },
      position,
      dir: occupant.dir,
      track: isMe ? null : new RemoteTrack(position, now),
      walking: false,
      airborne: false,
      airborneSince: 0,
      lastY: position.y,
      lastMovedAt: 0,
      bubbles: [],
      emoteUntil: 0,
      hopUntil: 0,
      motion: null,
      animator: look.manifest.animator ? startAnimator(look.manifest.animator, now) : null,
      voice: this.voice.get(occupant.user.id) ?? null,
      pose: characterPose(look.manifest, `idle-${occupant.dir}`, occupant.dir, 0),
      lift: 0,
      groundY: position.y,
      groundAlpha: 1,
    };
    // 반복 중이던 모션은 나중에 연 사람에게도 보인다
    if (occupant.motion) this.applyMotion(actor, occupant.motion, true, now);
    this.actors.set(occupant.user.id, actor);
  }

  /** 닉네임이나 캐릭터가 바뀌었다 (user:updated) */
  updateUser(user: UserProfile): void {
    const actor = this.actors.get(user.id);
    if (!actor) return;
    actor.user = user;
    const look = this.lookOf(user);
    if (look.key === actor.look.key) return;
    actor.look = look;
    actor.size = sizeOf(look.manifest);
    actor.animation = { name: '', start: 0 };
    actor.animator = look.manifest.animator
      ? startAnimator(look.manifest.animator, performance.now())
      : null;
  }

  remove(userId: string): void {
    if (userId === this.options.meId) return;
    this.actors.delete(userId);
  }

  moved(event: PlazaMoved): void {
    const actor = this.actors.get(event.userId);
    if (!actor?.track) return;
    actor.track.push(event, performance.now());
    actor.dir = event.dir;
    // 움직이면 모션은 멈춘다 (서버도 반복 모션을 지운다)
    if (event.moving) actor.motion = null;
  }

  /** 서버가 내 이동을 받아들이지 않았다: 그 자리로 되돌린다 */
  corrected(correction: PlazaCorrection): void {
    const me = this.me;
    if (!me) return;
    me.position = { x: correction.x, y: correction.y };
    me.dir = correction.dir;
    this.path = [];
    this.sideTarget = null;
    this.marker = null;
    if (this.side && this.layout) this.body = createSideBody(this.layout, me.position);
    this.lastSent = { ...me.position, dir: me.dir, moving: false, at: performance.now() };
  }

  /** 통화 상태 (참여 중인 음성 채널, 말하는 중) */
  setVoice(states: ReadonlyMap<string, ActorVoice>): void {
    this.voice = states;
    for (const actor of this.actors.values()) actor.voice = states.get(actor.user.id) ?? null;
  }

  /** 메시지 → 작성자 캐릭터 위 말풍선 (첨부 메시지는 첨부 모션이나 제자리 뛰기도) */
  say(userId: string, bubble: Bubble): void {
    const actor = this.actors.get(userId);
    if (!actor) return;
    const now = performance.now();
    actor.bubbles = pushBubble(actor.bubbles, bubble, now);
    if (bubble.kind !== 'attachment-emote') return;
    const duration = emoteDurationMs(actor.look.manifest);
    if (duration > 0) {
      actor.emoteUntil = now + duration;
      actor.animation = { name: 'emote', start: now };
    } else {
      actor.hopUntil = now + ATTACHMENT_HOP_MS;
    }
    // 애니메이터가 있으면 첨부 보냄 트리거로 알린다 (어떤 상태로 갈지는 그래프가 정함)
    if (actor.animator) fireTrigger(actor.animator, 'emote', now);
  }

  /** 메시지를 고쳤다: 떠 있는 말풍선의 글만 바꾼다 */
  editBubble(messageId: string, text: string): void {
    for (const actor of this.actors.values()) {
      actor.bubbles = actor.bubbles.map((b) => (b.id === messageId ? { ...b, text } : b));
    }
  }

  /** 메시지를 지웠다: 떠 있는 말풍선을 내린다 */
  removeBubble(messageId: string): void {
    for (const actor of this.actors.values()) {
      actor.bubbles = actor.bubbles.filter((b) => b.id !== messageId);
    }
  }

  // ── 캐릭터 모션 (키) ──

  get me(): WorldActor | undefined {
    return this.actors.get(this.options.meId);
  }

  /** 내 캐릭터의 모션 (키 순서). 직접 그린 캐릭터에 추가한 것만 있다 */
  myMotions() {
    const me = this.me;
    return me ? characterMotions(me.look.manifest) : [];
  }

  /** 내 캐릭터의 그 키 모션을 튼다. 반복 모션을 다시 누르면 멈춘다. 그 키의 모션이 없으면 false */
  playMotion(key: string): boolean {
    const me = this.me;
    if (!me) return false;
    const motion = characterMotions(me.look.manifest).find((m) => m.key === key);
    if (!motion) return false;
    const now = performance.now();
    if (motion.parameter && me.animator) {
      if (motion.hold) {
        if (this.heldMotions.has(key)) return true;
        this.heldMotions.set(key, { name: motion.name, at: now });
        this.applyMotion(me, motion.name, true, now);
        this.options.onMotion(motion.name, true);
        return true;
      }
      const on = motion.parameter === AnimatorParamType.Bool && !me.animator.bools.get(motion.name);
      this.applyMotion(me, motion.name, on, now);
      this.options.onMotion(motion.name, on);
      return true;
    }
    if (me.motion?.name === motion.name && me.motion.loop && me.motion.until > now) {
      me.motion = null;
      this.options.onMotion(null, false);
      return true;
    }
    this.startMotion(me, motion.name, motion.loop, now);
    this.options.onMotion(motion.name, motion.loop);
    return true;
  }

  /**
   * 키(버튼)를 뗐다: 누르는 동안 켜 둔 모션이면 끈다. 서버는 150ms보다 잦은 모션 요청을 버리므로, 누르자마자
   * 떼면 다른 사람에게는 조금 늦게 알린다.
   */
  releaseMotion(key: string): void {
    const held = this.heldMotions.get(key);
    if (!held) return;
    this.heldMotions.delete(key);
    const me = this.me;
    if (me) this.applyMotion(me, held.name, false, performance.now());
    const wait = MOTION_SEND_GAP_MS - (performance.now() - held.at);
    if (wait <= 0) {
      this.options.onMotion(held.name, false);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.options.onMotion(held.name, false);
    }, wait);
    this.timers.add(timer);
  }

  /** 누르는 동안 켜 둔 모션을 모두 끈다 (화면을 떠날 때) */
  releaseAllMotions(): void {
    for (const key of [...this.heldMotions.keys()]) this.releaseMotion(key);
  }

  /** 다른 사람이 모션을 틀거나(이름) 멈췄다(null) */
  setMotion(userId: string, motion: string | null, loop: boolean): void {
    const actor = this.actors.get(userId);
    if (!actor || userId === this.options.meId) return;
    if (motion) this.applyMotion(actor, motion, loop, performance.now());
    else actor.motion = null;
  }

  private applyMotion(actor: WorldActor, name: string, loop: boolean, now: number): void {
    const parameter = actor.look.manifest.animator?.parameters.find((p) => p.name === name);
    if (parameter && actor.animator) {
      if (parameter.type === AnimatorParamType.Trigger) fireTrigger(actor.animator, name, now);
      else setAnimatorBool(actor.animator, name, loop);
      return;
    }
    if (actor.look.manifest.animations[name]) this.startMotion(actor, name, loop, now);
  }

  private startMotion(actor: WorldActor, name: string, loop: boolean, now: number): void {
    const until = loop ? Infinity : now + motionDurationMs(actor.look.manifest, name);
    actor.motion = { name, loop, until, start: now };
    actor.animation = { name, start: now };
  }

  // ── 누른 곳으로 걸어가기 ──

  /** 화면에서 누른 곳(월드 좌표)으로 걸어간다. 갈 수 없는 곳이면 아무것도 하지 않는다 */
  walkTo(target: Position): void {
    const me = this.me;
    if (!me || !this.layout) return;
    if (this.side) {
      this.walkToSide(target);
      return;
    }
    const path = findPath(this.layout, me.position, target);
    if (path.length === 0) return;
    // 지금 서 있는 칸의 가운데를 먼저 거쳐서, 칸 모서리를 비스듬히 파고들지 않게 한다.
    const start = tileCenter(
      Math.floor(me.position.x / TILE_SIZE),
      Math.floor((me.position.y - 1) / TILE_SIZE),
    );
    this.path = [start, ...path];
    const end = path.at(-1)!;
    this.marker = { x: end.x, y: end.y - 2 };
  }

  private walkToSide(target: Position): void {
    const layout = this.layout!;
    const x = Math.min(Math.max(target.x, 6), layout.width * TILE_SIZE - 6);
    this.path = [];
    let y = Math.min(target.y, layout.height * TILE_SIZE);
    // 땅 속을 눌렀으면 그 땅의 윗면까지 올린다
    while (y > 0 && !isWalkable(layout, x, y)) y -= TILE_SIZE / 2;
    const ground = groundBelow(layout, x, y);
    this.sideTarget = {
      x,
      groundY: ground,
      blocked: false,
      progressAt: performance.now(),
      jumps: 0,
    };
    this.marker = { x, y: ground - 2 };
  }

  private stopWalking(): void {
    this.path = [];
    this.sideTarget = null;
    this.marker = null;
  }

  // ── 프레임마다 ──

  /** 한 프레임 진행: 내 캐릭터를 움직이고(조작 또는 누른 곳으로), 다른 사람을 보간하고, 모습을 정한다 */
  update(now: number, delta: number, control: PlazaControl = NO_CONTROL): void {
    if (!this.layout) return;
    const me = this.me;
    if (me) {
      if (this.side) this.moveMeSide(me, delta, now, control);
      else this.moveMe(me, delta, now, control);
    }
    for (const actor of this.actors.values()) {
      if (actor.track) {
        const next = actor.track.at(now);
        actor.walking = Math.hypot(next.x - actor.position.x, next.y - actor.position.y) > 0.01;
        actor.position = next;
      }
      this.poseActor(actor, now);
      actor.bubbles = activeBubbles(actor.bubbles, now);
    }
  }

  /** 기술을 쓰는 동안(애니메이터 상태가 이동을 막음)인지. 이번 프레임에 당긴 트리거까지 보도록 한 걸음 옮긴다 */
  private movementLocked(me: WorldActor, now: number): boolean {
    const { manifest } = me.look;
    const animator = manifest.animator;
    if (!animator || !me.animator) return false;
    stepAnimator(animator, me.animator, now, (state) => animatorCycleMs(manifest, state, me.dir));
    return animatorLocksMovement(animator, me.animator);
  }

  private moveMe(me: WorldActor, delta: number, now: number, control: PlazaControl): void {
    const layout = this.layout!;
    const locked = this.movementLocked(me, now);
    const dx = locked ? 0 : control.dx;
    const dy = locked ? 0 : control.dy;
    const before = me.position;
    if (locked) {
      // 그대로 서 있는다
    } else if (dx !== 0 || dy !== 0) {
      // 직접 움직이면 누른 곳으로 걸어가기는 그만둔다
      this.stopWalking();
      me.position = stepByInput(layout, before, dx, dy, delta);
      me.dir =
        Math.abs(dx) >= Math.abs(dy)
          ? directionOf(Math.sign(dx), 0, me.dir)
          : directionOf(0, Math.sign(dy), me.dir);
    } else if (this.path.length > 0) {
      const step = stepToward(layout, before, this.path[0]!, delta);
      if (!step) {
        this.path = [];
      } else {
        me.position = step.position;
        if (step.arrived) this.path.shift();
        const ddx = step.position.x - before.x;
        const ddy = step.position.y - before.y;
        me.dir =
          Math.abs(ddx) >= Math.abs(ddy)
            ? directionOf(Math.sign(ddx), 0, me.dir)
            : directionOf(0, Math.sign(ddy), me.dir);
      }
      if (this.path.length === 0) this.marker = null;
    }
    me.walking = me.position.x !== before.x || me.position.y !== before.y;
    if (me.walking) me.motion = null;
    this.sendMove(me, now);
  }

  private moveMeSide(me: WorldActor, delta: number, now: number, control: PlazaControl): void {
    const layout = this.layout!;
    const locked = this.movementLocked(me, now);
    let dx = locked ? 0 : Math.sign(control.dx);
    const jump = !locked && control.jump;
    const jumpHeld = !locked && control.jumpHeld;
    const drop = !locked && control.drop;
    if (dx !== 0 || jump || drop) this.stopWalking();

    const before = this.body ?? createSideBody(layout, me.position);
    let autoJump = false;
    const target = this.sideTarget;
    if (target && locked) target.progressAt = now;
    if (target && dx === 0 && !locked) {
      const gap = target.x - before.x;
      if (now - target.progressAt > SIDE_STUCK_MS) {
        this.stopWalking();
      } else if (Math.abs(gap) <= 1.5) {
        // 도착했다. 누른 곳이 위(발판)면 제자리에서 뛰어 오른다.
        if (before.grounded) {
          if (target.groundY < before.y - 4 && target.jumps < SIDE_TARGET_JUMPS) {
            autoJump = true;
            target.jumps++;
            target.progressAt = now;
          } else {
            this.stopWalking();
          }
        }
      } else {
        dx = Math.sign(gap);
        // 지난 프레임에 턱이나 벽에 막혀 못 갔으면 뛰어서 넘어 본다
        autoJump = target.blocked && before.grounded;
      }
    }
    const body = stepSide(
      layout,
      before,
      { dx, jump: jump || autoJump, jumpHeld: jumpHeld || (!!this.sideTarget && !locked), drop },
      delta,
    );
    if (this.sideTarget) {
      const moved = Math.abs(body.x - before.x) > 0.01;
      this.sideTarget.blocked = !moved;
      if (moved) this.sideTarget.progressAt = now;
    }
    this.body = body;
    me.position = { x: body.x, y: body.y };
    if (dx !== 0) me.dir = dx < 0 ? 'left' : 'right';
    me.walking = body.x !== before.x || body.y !== before.y;
    if (me.walking) me.motion = null;
    // 내려앉거나 뛰어오르는 순간은 바로 보낸다: 서버가 딛은 땅을 알아야 다음 점프를 받아들인다.
    this.sendMove(me, now, body.grounded !== before.grounded);
  }

  /** 움직이는 동안은 일정 간격으로, 멈추면 한 번 더 (멈춘 자리) 보낸다. force면 간격과 상관없이 보낸다 */
  private sendMove(me: WorldActor, now: number, force = false): void {
    const state: MoveState = { ...me.position, dir: me.dir, moving: me.walking };
    const last = this.lastSent;
    if (!force) {
      if (me.walking) {
        if (last && now - last.at < MOVE_SEND_INTERVAL_MS) return;
      } else if (!last?.moving) {
        return;
      }
    }
    this.lastSent = { ...state, at: now };
    this.options.onMove(state);
  }

  /** 모습(프레임, 뒤집기), 제자리 뛰기 높이, 그림자 자리를 정한다 */
  private poseActor(actor: WorldActor, now: number): void {
    const { x, y } = actor.position;
    if (actor.walking) actor.lastMovedAt = now;
    const airborne =
      this.side &&
      (actor.isMe && this.body ? !this.body.grounded : !isGrounded(this.layout!, x, y));
    if (airborne && !actor.airborne) actor.airborneSince = now;
    if (actor.animator && airborne !== actor.airborne) {
      fireTrigger(actor.animator, airborne ? 'jump' : 'land', now);
    }
    actor.airborne = airborne;
    if (actor.animator) {
      setAnimatorBool(actor.animator, 'falling', airborne && y > actor.lastY + 0.01);
    }
    actor.lastY = y;
    if (actor.motion && actor.motion.until <= now) actor.motion = null;
    actor.pose =
      actor.animator && actor.look.manifest.animator
        ? this.animatorPoseOf(actor, now)
        : this.rulePoseOf(actor, now);
    actor.lift =
      actor.hopUntil > now ? Math.round(Math.abs(Math.sin((actor.hopUntil - now) / 60)) * 4) : 0;
    if (this.side) {
      const ground = groundBelow(this.layout!, x, y);
      actor.groundY = ground;
      actor.groundAlpha = Math.max(0.2, 1 - Math.max(0, ground - y) / 64);
    } else {
      actor.groundY = y;
      actor.groundAlpha = 1;
    }
  }

  private animatorPoseOf(actor: WorldActor, now: number): CharacterPose {
    const runtime = actor.animator!;
    const { manifest } = actor.look;
    const animator = manifest.animator!;
    setAnimatorBool(runtime, 'moving', now - actor.lastMovedAt < WALK_HOLD_MS);
    setAnimatorBool(runtime, 'airborne', actor.airborne);
    stepAnimator(animator, runtime, now, (state) => animatorCycleMs(manifest, state, actor.dir));
    if (actor.motion && actor.motion.until > now) {
      return characterPose(
        manifest,
        actor.motion.name,
        actor.dir,
        now - actor.motion.start,
        !actor.motion.loop,
      );
    }
    const state = animator.states.find((s) => s.name === runtime.state);
    return state
      ? animatorPose(manifest, state, actor.dir, now - runtime.since)
      : characterPose(manifest, `idle-${actor.dir}`, actor.dir, 0);
  }

  /** 애니메이터가 없는 캐릭터: 첨부 모션 > 캐릭터 모션 > 공중 > 걷기·대기 */
  private rulePoseOf(actor: WorldActor, now: number): CharacterPose {
    const name = animationName(
      {
        dir: actor.dir,
        walking: now - actor.lastMovedAt < WALK_HOLD_MS,
        emoteUntil: actor.emoteUntil,
        motion: actor.motion,
      },
      now,
    );
    if (actor.animation.name !== name) actor.animation = { name, start: now };
    const { manifest } = actor.look;
    const playing = name === 'emote' || name === actor.motion?.name;
    return actor.airborne && !playing
      ? airbornePose(manifest, actor.dir, now - actor.airborneSince)
      : characterPose(
          manifest,
          name,
          actor.dir,
          now - actor.animation.start,
          name === 'emote' || (name === actor.motion?.name && !actor.motion.loop),
        );
  }

  // ── 카메라 ──

  /** 화면 크기(화면 단위)가 바뀌었다: 배율을 다시 정한다 */
  resize(width: number, height: number): void {
    this.view = { width, height };
    this.updateZoom();
  }

  private updateZoom(): void {
    if (!this.layout || this.view.width === 0) return;
    this.zoom = zoomFor(this.layout, this.view.width, this.view.height, this.zoomOffset);
  }

  /** 배율을 한 단계 올리거나 내린다. 바뀐 배율과 기억해 둘 단계 (맵이 없으면 null) */
  zoomBy(step: 1 | -1): { zoom: number; offset: number } | null {
    if (!this.layout || this.view.width === 0) return null;
    this.zoomOffset = stepZoomOffset(
      this.layout,
      this.view.width,
      this.view.height,
      this.zoomOffset,
      step,
    );
    this.updateZoom();
    return { zoom: this.zoom, offset: this.zoomOffset };
  }

  /** 화면 가운데에 올 월드 좌표: 내 캐릭터를 따라가되, 맵이 화면보다 작은 쪽은 맵 가운데 */
  cameraCenter(zoom = this.zoom): Position {
    const layout = this.layout;
    if (!layout) return { x: 0, y: 0 };
    const { width, height } = this.view;
    const axis = (mapPx: number, viewPx: number, target: number) => {
      const half = viewPx / zoom / 2;
      if (mapPx <= half * 2) return mapPx / 2;
      return Math.min(Math.max(target, half), mapPx - half);
    };
    const mapW = layout.width * TILE_SIZE;
    const mapH = layout.height * TILE_SIZE;
    const focus = this.me?.position ?? { x: mapW / 2, y: mapH / 2 };
    return {
      x: axis(mapW, width, focus.x),
      y: axis(mapH, height, focus.y - CHARACTER_WORLD_HEIGHT / 2),
    };
  }

  /** 화면을 떠날 때: 기다리던 모션 알림을 버린다 */
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private lookOf(user: UserProfile): CharacterLook {
    return resolveCharacterLook(user.id, characterFor(user, this.style), this.assetOf);
  }
}

/** 광장에서 그릴 캐릭터 크기 (세로는 캐릭터가 정한 광장 크기, 가로는 그림 비율대로) */
function sizeOf(manifest: AssetManifest): { width: number; height: number } {
  return characterWorldSize(manifest.width, manifest.height, manifest.plazaHeight);
}
