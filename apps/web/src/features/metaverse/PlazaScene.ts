import {
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
  buildCollision,
  characterMotions,
  groundBelow,
  isGrounded,
  isWalkable,
  mapStyle,
} from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import {
  type IconNode,
  Image as ImageIcon,
  MicOff,
  MonitorUp,
  Paperclip,
  Phone,
  Volume2,
  createElement as createIcon,
} from 'lucide';
import Phaser from 'phaser';
import {
  SIDE_SKY,
  drawCloud,
  drawHills,
  drawShadow,
  drawSpeakingRing,
  drawTargetMarker,
} from './art';
import {
  type Bubble,
  activeBubbles,
  pushBubble,
  stepZoomOffset,
  zoomFor,
  RemoteTrack,
  directionOf,
  stepByInput,
  stepToward,
  findPath,
  tileCenter,
  type SideBody,
  createSideBody,
  stepSide,
} from '@metacode/client';
import type { VoiceLabel } from './plazaVoice';
import {
  type CharacterLook,
  type PlayingMotion,
  airborneFrame,
  animationName,
  characterFrame,
  characterLook,
  emoteDurationMs,
  fitCharacter,
  motionDurationMs,
} from './characterSprite';
import { MapView, SIDE_ACTOR_DEPTH } from './mapView';

/** 이만큼 움직이지 않아야 걷기를 멈춘다 (받은 위치 사이에서 걷기 모션이 끊겼다 이어지지 않게) */
const WALK_HOLD_MS = 120;
/** 횡스크롤 점프 키 */
const JUMP_KEYS = ['ArrowUp', ' '];
/** 횡스크롤 클릭 이동: 막혀서 이만큼 못 가면 그만둔다 */
const SIDE_STUCK_MS = 1500;
/** 횡스크롤 클릭 이동: 누른 곳이 위(발판)면 제자리에서 이만큼까지 뛰어 오른다 */
const SIDE_TARGET_JUMPS = 3;
export interface MoveState extends Position {
  dir: Direction;
  moving: boolean;
}

/** 통화 중인 캐릭터에 보일 것: 참여 중인 음성 채널, 말하는 중, 음소거 */
export interface ActorVoice {
  label: VoiceLabel;
  /** 화면을 공유 중 */
  sharing: boolean;
  speaking: boolean;
  muted: boolean;
}

/**
 * 캐릭터 위 DOM 층(이름표, 통화 표시, 첨부 표시)에 넣을 아이콘. React 밖이라 lucide 기본판으로 만든다.
 * 크기와 색은 styles.css의 `.lucide`(글자 크기, currentColor)를 따른다.
 */
function icon(node: IconNode, label?: string): SVGElement {
  const svg = createIcon(node, { class: 'lucide', 'aria-hidden': label ? 'false' : 'true' });
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  }
  return svg;
}

export interface PlazaSceneOptions {
  meId: string;
  /** 캐릭터 위의 이름표와 말풍선을 올릴 DOM 층 (글자는 화면 해상도로 그린다) */
  overlay: HTMLElement;
  nameOf(user: UserProfile): string;
  /** 내 캐릭터 위치를 서버에 보낸다 */
  onMove(state: MoveState): void;
  /** 내 캐릭터 모션을 틀거나(이름) 멈췄다(null): 서버에 보낸다 */
  onMotion(motion: string | null, loop: boolean): void;
  /** 처음 배율 단계 (사용자가 Ctrl +/−로 바꾼 값, 기억해 둔 것) */
  zoomOffset?: number;
}

interface Actor {
  user: UserProfile;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** 말하는 중이면 보이는 발밑 고리 */
  ring: Phaser.GameObjects.Image;
  look: CharacterLook;
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
  /** 공중에 뜬 시각 (점프 애니메이션의 시작) */
  airborneSince: number;
  lastMovedAt: number;
  bubbles: Bubble[];
  renderedBubbles: string;
  bubblesWidth: number;
  /** 첨부 모션이 끝나는 시각 */
  emoteUntil: number;
  /** 틀고 있는 캐릭터 모션 (숫자 키). 움직이면 멈춘다 */
  motion: (PlayingMotion & { start: number }) | null;
  dom: {
    root: HTMLDivElement;
    bubbles: HTMLOListElement;
    voice: HTMLSpanElement;
    name: HTMLSpanElement;
  };
}

/**
 * 광장 하나를 그리는 씬. 맵(배치 + 테마), 광장 인원의 캐릭터, 내 캐릭터 이동(방향키, 클릭),
 * 다른 사람 위치 보간, 말풍선을 맡는다. 서버와의 통신은 PlazaView가 하고 여기에는 결과만 넣는다.
 */
export class PlazaScene extends Phaser.Scene {
  private readonly options: PlazaSceneOptions;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  private layout: MapLayout | null = null;
  private style: PlazaStyle = PlazaStyle.TopDown;
  private map: { key: string; view: MapView } | null = null;
  /** 횡스크롤 하늘의 구름·언덕 (맵을 다시 그릴 때 치운다) */
  private backdrop: Phaser.GameObjects.GameObject[] = [];
  /** 횡스크롤: 내 캐릭터의 몸 (위치와 세로 속도). 탑다운에서는 null */
  private body: SideBody | null = null;
  /**
   * 횡스크롤 클릭 이동: 걸어갈 x와 누른 곳의 땅 높이, 지난 프레임에 막혔는지, 마지막으로 나아간 시각,
   * 누른 곳이 위라서 뛴 횟수
   */
  private sideTarget: {
    x: number;
    groundY: number;
    blocked: boolean;
    progressAt: number;
    jumps: number;
  } | null = null;
  /** 서버에서 받은 에셋(직접 그린 캐릭터 등). 내장 에셋은 builtinAsset으로 찾는다 */
  private readonly customAssets = new Map<AssetRef, AssetManifest>();
  private readonly assetOf = (ref: AssetRef) => this.customAssets.get(ref) ?? builtinAsset(ref);
  private actors = new Map<string, Actor>();
  private path: Position[] = [];
  private marker: Phaser.GameObjects.Image | null = null;
  private voice: ReadonlyMap<string, ActorVoice> = new Map();
  private lastSent: (MoveState & { at: number }) | null = null;
  private zoomLevel = 2;
  /** 사용자가 Ctrl +/−로 더하거나 뺀 배율 단계 */
  private zoomOffset = 0;
  /** 눌려 있는 방향키. PlazaView가 광장 패널에 포커스가 있을 때만 넣는다 */
  private readonly held = new Set<string>();
  /** 지난 프레임 이후 눌린 키. 프레임 사이에 눌렀다 뗀 짧은 입력도 한 걸음은 움직이게 한다 */
  private readonly tapped = new Set<string>();

  constructor(options: PlazaSceneOptions) {
    super('plaza');
    this.options = options;
    this.zoomOffset = options.zoomOffset ?? 0;
    this.readyPromise = new Promise((resolve) => (this.resolveReady = resolve));
  }

  /** create()가 끝나면 풀린다. 그 전에는 텍스처를 만들 수 없다 */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  create(): void {
    this.textures.addCanvas('shadow', drawShadow());
    this.textures.addCanvas('target', drawTargetMarker());
    this.textures.addCanvas('speaking-ring', drawSpeakingRing());
    for (let i = 0; i < 3; i++) this.textures.addCanvas(`cloud-${i}`, drawCloud(i));
    this.textures.addCanvas('hills', drawHills());
    this.cameras.main.setRoundPixels(true);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.updateZoom());
    this.updateZoom();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return;
      this.walkTo(this.screenToWorld(pointer.x, pointer.y));
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearActors();
      this.clearBackdrop();
      this.map?.view.destroy();
      this.map = null;
    });
    this.resolveReady();
  }

  // ── 서버에서 받은 것 반영 ──

  /** 광장을 (다시) 열었을 때: 맵을 그리고 인원을 전부 새로 둔다 */
  applySnapshot(snapshot: PlazaSnapshot): void {
    this.drawMap(snapshot.definition, snapshot.assets);
    this.clearActors();
    this.path = [];
    this.body = null;
    this.sideTarget = null;
    this.lastSent = null;
    for (const occupant of snapshot.occupants) this.upsert(occupant);
  }

  private get side(): boolean {
    return this.style === PlazaStyle.SideScroll;
  }

  upsert(occupant: PlazaOccupant): void {
    const existing = this.actors.get(occupant.user.id);
    if (existing) {
      this.updateUser(occupant.user);
      return;
    }
    const look = characterLook(this, occupant.user.id, occupant.user.character, this.assetOf);
    const isMe = occupant.user.id === this.options.meId;
    const position = { x: occupant.x, y: occupant.y };
    const actor: Actor = {
      user: occupant.user,
      shadow: this.add.image(position.x, position.y, 'shadow').setOrigin(0.5, 0.6),
      ring: this.add
        .image(position.x, position.y, 'speaking-ring')
        .setOrigin(0.5, 0.6)
        .setVisible(false),
      sprite: fitCharacter(
        this.add
          .image(
            position.x,
            position.y,
            look.key,
            characterFrame(look.manifest, `idle-${occupant.dir}`, occupant.dir, 0),
          )
          .setOrigin(0.5, 1),
      ),
      look,
      animation: { name: `idle-${occupant.dir}`, start: 0 },
      position,
      dir: occupant.dir,
      track: isMe ? null : new RemoteTrack(position, performance.now()),
      walking: false,
      airborne: false,
      airborneSince: 0,
      lastMovedAt: 0,
      bubbles: [],
      renderedBubbles: '',
      bubblesWidth: 0,
      emoteUntil: 0,
      // 반복 중이던 모션은 나중에 연 사람에게도 보인다
      motion: occupant.motion
        ? { name: occupant.motion, loop: true, until: Infinity, start: performance.now() }
        : null,
      dom: this.createActorDom(occupant.user, isMe),
    };
    this.actors.set(occupant.user.id, actor);
    this.applyVoice(actor);
  }

  /** 받아 온 에셋을 등록한다. 그 뒤 updateUser()로 캐릭터를 다시 그린다 */
  addAsset(ref: AssetRef, manifest: AssetManifest): void {
    this.customAssets.set(ref, manifest);
  }

  /** 닉네임이나 캐릭터가 바뀌었다 (user:updated): 이름표와 캐릭터 모습을 고친다 */
  updateUser(user: UserProfile): void {
    const actor = this.actors.get(user.id);
    if (!actor) return;
    actor.user = user;
    actor.dom.name.textContent = this.options.nameOf(user);
    const look = characterLook(this, user.id, user.character, this.assetOf);
    if (look.key !== actor.look.key) {
      actor.look = look;
      actor.sprite.setTexture(look.key, 0);
      // 해상도가 다른 캐릭터로 바뀌었을 수 있으므로 월드 크기를 다시 맞춘다.
      fitCharacter(actor.sprite);
      actor.animation = { name: '', start: 0 };
    }
  }

  remove(userId: string): void {
    const actor = this.actors.get(userId);
    if (!actor || userId === this.options.meId) return;
    this.destroyActor(actor);
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

  // ── 캐릭터 모션 (숫자 키) ──

  /** 내 캐릭터의 모션 (키 순서). 직접 그린 캐릭터에 추가한 것만 있다 */
  myMotions() {
    const me = this.actors.get(this.options.meId);
    return me ? characterMotions(me.look.manifest) : [];
  }

  /**
   * 숫자 키: 내 캐릭터의 그 키 모션을 튼다. 반복 모션을 다시 누르면 멈춘다. 그 키의 모션이 없으면 false
   * (PlazaView가 키를 브라우저에 그대로 넘긴다).
   */
  playMotion(key: string): boolean {
    const me = this.actors.get(this.options.meId);
    if (!me) return false;
    const motion = characterMotions(me.look.manifest).find((m) => m.key === key);
    if (!motion) return false;
    const now = performance.now();
    if (me.motion?.name === motion.name && me.motion.loop && me.motion.until > now) {
      me.motion = null;
      this.options.onMotion(null, false);
      return true;
    }
    this.startMotion(me, motion.name, motion.loop, now);
    this.options.onMotion(motion.name, motion.loop);
    return true;
  }

  /** 다른 사람이 모션을 틀거나(이름) 멈췄다(null) */
  setMotion(userId: string, motion: string | null, loop: boolean): void {
    const actor = this.actors.get(userId);
    if (!actor || userId === this.options.meId) return;
    if (motion) this.startMotion(actor, motion, loop, performance.now());
    else actor.motion = null;
  }

  private startMotion(actor: Actor, name: string, loop: boolean, now: number): void {
    const until = loop ? Infinity : now + motionDurationMs(actor.look.manifest, name);
    actor.motion = { name, loop, until, start: now };
    actor.animation = { name, start: now };
  }

  /** 서버가 내 이동을 받아들이지 않았다: 그 자리로 되돌린다 */
  corrected(correction: PlazaCorrection): void {
    const me = this.actors.get(this.options.meId);
    if (!me) return;
    me.position = { x: correction.x, y: correction.y };
    me.dir = correction.dir;
    this.path = [];
    this.sideTarget = null;
    if (this.side && this.layout) this.body = createSideBody(this.layout, me.position);
    this.lastSent = { ...me.position, dir: me.dir, moving: false, at: performance.now() };
    this.marker?.setVisible(false);
  }

  /** 메시지 → 작성자 캐릭터 위 말풍선 (또는 첨부 임시 표시) */
  /** 통화 상태: 광장을 보는 모든 사람에게 캐릭터마다 참여 중인 음성 채널과 말하는 중을 보여 준다 */
  setVoice(states: ReadonlyMap<string, ActorVoice>): void {
    this.voice = states;
    for (const actor of this.actors.values()) this.applyVoice(actor);
  }

  private applyVoice(actor: Actor): void {
    const state = this.voice.get(actor.user.id);
    const speaking = !!state?.speaking && !state.muted;
    actor.dom.voice.hidden = !state;
    // 내용이 바뀔 때만 다시 만든다 (말하는 중만 바뀌면 그대로 둔다).
    const key = state
      ? `${state.label.kind}|${state.label.name}|${state.sharing}|${state.muted}`
      : '';
    if (actor.dom.voice.dataset.key !== key) {
      actor.dom.voice.dataset.key = key;
      actor.dom.voice.replaceChildren(
        ...(state
          ? [
              icon(state.label.kind === 'channel' ? Volume2 : Phone),
              document.createTextNode(state.label.name),
              ...(state.sharing ? [icon(MonitorUp, '화면 공유 중')] : []),
              ...(state.muted ? [icon(MicOff, '마이크 꺼짐')] : []),
            ]
          : []),
      );
    }
    actor.dom.root.classList.toggle('plaza-actor--speaking', speaking);
    actor.ring.setVisible(speaking);
  }

  say(userId: string, bubble: Bubble): void {
    const actor = this.actors.get(userId);
    if (!actor) return;
    const now = performance.now();
    actor.bubbles = pushBubble(actor.bubbles, bubble, now);
    // 첨부 메시지: 캐릭터의 첨부 모션(emote)을 처음부터 한 번 튼다.
    if (bubble.kind === 'attachment-emote') {
      actor.emoteUntil = now + emoteDurationMs(actor.look.manifest);
      actor.animation = { name: 'emote', start: now };
    }
  }

  /** 메시지를 고쳤다: 아직 떠 있는 말풍선의 글만 바꾼다 (보이는 시간은 그대로) */
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

  // ── 키보드 ──

  press(key: string): void {
    this.held.add(key);
    this.tapped.add(key);
  }

  release(key: string): void {
    this.held.delete(key);
  }

  releaseAll(): void {
    this.held.clear();
  }

  // ── 프레임마다 ──

  override update(_time: number, delta: number): void {
    if (!this.layout) return;
    const now = performance.now();
    const me = this.actors.get(this.options.meId);
    if (me) this.moveMe(me, delta, now);

    for (const actor of this.actors.values()) {
      if (actor.track) {
        const next = actor.track.at(now);
        actor.walking = Math.hypot(next.x - actor.position.x, next.y - actor.position.y) > 0.01;
        actor.position = next;
      }
      this.renderActor(actor, now);
    }

    this.map?.view.tick(now);
    this.updateCamera(me?.position);
    this.updateOverlay(now);
  }

  private moveMe(me: Actor, delta: number, now: number): void {
    if (this.side) {
      this.moveMeSide(me, delta, now);
      return;
    }
    const layout = this.layout!;
    const down = (key: string) => (this.held.has(key) || this.tapped.has(key) ? 1 : 0);
    const dx = down('ArrowRight') - down('ArrowLeft');
    const dy = down('ArrowDown') - down('ArrowUp');
    this.tapped.clear();
    const before = me.position;

    if (dx !== 0 || dy !== 0) {
      // 방향키를 누르면 클릭 이동은 취소한다.
      this.path = [];
      this.marker?.setVisible(false);
      me.position = stepByInput(layout, before, dx, dy, delta);
      me.dir = directionOf(dx, dy, me.dir);
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
      if (this.path.length === 0) this.marker?.setVisible(false);
    }

    me.walking = me.position.x !== before.x || me.position.y !== before.y;
    if (me.walking) me.motion = null;
    this.sendMove(me, now);
  }

  /**
   * 횡스크롤: 좌우로 걷고(←→), 점프하고(↑, Space: 누르고 있으면 높이), 발판 아래로 내려간다(↓).
   * 클릭 이동은 누른 곳의 x까지 걸어가고, 막히면 뛰어 본다.
   */
  private moveMeSide(me: Actor, delta: number, now: number): void {
    const layout = this.layout!;
    const down = (key: string) => this.held.has(key) || this.tapped.has(key);
    let dx = (down('ArrowRight') ? 1 : 0) - (down('ArrowLeft') ? 1 : 0);
    const jump = JUMP_KEYS.some((key) => this.tapped.has(key));
    const jumpHeld = JUMP_KEYS.some((key) => this.held.has(key));
    const drop = this.tapped.has('ArrowDown');
    this.tapped.clear();
    if (dx !== 0 || jump || drop) this.stopSideTarget();

    const before = this.body ?? createSideBody(layout, me.position);
    let autoJump = false;
    const target = this.sideTarget;
    if (target && dx === 0) {
      const gap = target.x - before.x;
      if (now - target.progressAt > SIDE_STUCK_MS) {
        this.stopSideTarget();
      } else if (Math.abs(gap) <= 1.5) {
        // 도착했다. 누른 곳이 위(발판)면 제자리에서 뛰어 오른다 (발판은 아래에서 뛰어 지나간다).
        if (before.grounded) {
          if (target.groundY < before.y - 4 && target.jumps < SIDE_TARGET_JUMPS) {
            autoJump = true;
            target.jumps++;
            target.progressAt = now;
          } else {
            this.stopSideTarget();
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
      { dx, jump: jump || autoJump, jumpHeld: jumpHeld || !!this.sideTarget, drop },
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

  private stopSideTarget(): void {
    this.sideTarget = null;
    this.marker?.setVisible(false);
  }

  /** 움직이는 동안은 일정 간격으로, 멈추면 한 번 더 (멈춘 자리) 보낸다. force면 간격과 상관없이 보낸다 */
  private sendMove(me: Actor, now: number, force = false): void {
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

  private walkTo(target: Position): void {
    const me = this.actors.get(this.options.meId);
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
    if (!this.marker) this.marker = this.add.image(0, 0, 'target').setDepth(0.5);
    this.marker.setPosition(end.x, end.y - 2).setVisible(true);
  }

  /** 횡스크롤 클릭 이동: 누른 곳의 x로 걸어간다. 표시는 그 아래 땅(또는 누른 땅의 윗면)에 */
  private walkToSide(target: Position): void {
    const layout = this.layout!;
    const mapWidth = layout.width * TILE_SIZE;
    const x = Math.min(Math.max(target.x, 6), mapWidth - 6);
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
    if (!this.marker) this.marker = this.add.image(0, 0, 'target');
    this.marker
      .setDepth(SIDE_ACTOR_DEPTH - 0.6)
      .setPosition(x, ground - 2)
      .setVisible(true);
  }

  private renderActor(actor: Actor, now: number): void {
    const { x, y } = actor.position;
    const side = this.side;
    if (actor.walking) actor.lastMovedAt = now;
    // 횡스크롤: 발밑이 땅(발판)에서 떨어져 있으면 공중 모습
    const isMe = actor.user.id === this.options.meId;
    const airborne =
      side && (isMe && this.body ? !this.body.grounded : !isGrounded(this.layout!, x, y));
    if (airborne && !actor.airborne) actor.airborneSince = now;
    actor.airborne = airborne;
    if (actor.motion && actor.motion.until <= now) actor.motion = null;
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
    actor.sprite.setFrame(
      airborne && !playing
        ? airborneFrame(manifest, actor.dir, now - actor.airborneSince)
        : characterFrame(
            manifest,
            name,
            actor.dir,
            now - actor.animation.start,
            name === 'emote' || (name === actor.motion?.name && !actor.motion.loop),
          ),
    );
    // 첨부 모션 동안에는 제자리에서 뛴다.
    const lift =
      actor.emoteUntil > now
        ? Math.round(Math.abs(Math.sin((actor.emoteUntil - now) / 60)) * 4)
        : 0;
    if (!side) {
      actor.sprite.setPosition(x, y - lift).setDepth(y);
      actor.shadow.setPosition(x, y).setDepth(1).setAlpha(1);
      if (actor.ring.visible) {
        actor.ring.setPosition(x, y + 1).setDepth(1.5);
        actor.ring.setAlpha(0.6 + 0.4 * Math.sin(now / 150));
      }
      return;
    }
    // 횡스크롤: 캐릭터는 배경(바닥 층·오브젝트) 앞, 그림자와 고리는 발 아래 땅에 (높이 뜰수록 옅게)
    const ground = groundBelow(this.layout!, x, y);
    const fade = Math.max(0.2, 1 - Math.max(0, ground - y) / 64);
    actor.sprite.setPosition(x, y - lift).setDepth(SIDE_ACTOR_DEPTH + y / 1e4);
    actor.shadow
      .setPosition(x, ground)
      .setDepth(SIDE_ACTOR_DEPTH - 0.5)
      .setAlpha(fade);
    if (actor.ring.visible) {
      actor.ring.setPosition(x, ground + 1).setDepth(SIDE_ACTOR_DEPTH - 0.4);
      actor.ring.setAlpha((0.6 + 0.4 * Math.sin(now / 150)) * fade);
    }
  }

  // ── 화면 ──

  /**
   * 맵을 (다시) 그린다. 같은 맵이면 그대로 둔다. 충돌 격자는 서버와 같은 맵 정의에서 계산한다.
   * 맵에 쓴 커뮤니티 에셋은 미리 addAsset()으로 등록해 둔다 (PlazaView가 받아 온다).
   */
  private drawMap(definition: MapDefinition, assets: PlazaSnapshot['assets']): void {
    // 맵에 쓴 에셋이 고쳐지면(버전이 바뀌면) 같은 맵 정의라도 다시 그린다.
    const key = JSON.stringify(definition) + JSON.stringify(assets);
    if (this.map?.key === key) return;
    this.map?.view.destroy();
    this.style = mapStyle(definition);
    this.layout = buildCollision(definition, this.assetOf);
    this.map = { key, view: new MapView(this, definition, this.assetOf) };
    this.drawBackdrop();
    this.updateZoom();
  }

  /**
   * 횡스크롤 하늘: 하늘색 배경, 멀리 있는 언덕 띠와 구름 두 겹. 카메라보다 천천히 움직여(패럴랙스)
   * 멀리 있는 것처럼 보인다. 세로로는 따라 움직여 언덕이 땅과 어긋나지 않게 한다.
   */
  private drawBackdrop(): void {
    this.clearBackdrop();
    const camera = this.cameras.main;
    if (!this.side || !this.layout) {
      camera.setBackgroundColor('rgba(0, 0, 0, 0)');
      return;
    }
    camera.setBackgroundColor(SIDE_SKY);
    const layout = this.layout;
    const width = layout.width * TILE_SIZE;
    const { spawn } = layout;
    const horizon = groundBelow(
      layout,
      (spawn.x + spawn.w / 2) * TILE_SIZE,
      (spawn.y + 1) * TILE_SIZE - 1,
    );
    this.backdrop.push(
      this.add
        .tileSprite(0, horizon + 8, width + 512, 48, 'hills')
        .setOrigin(0, 1)
        .setScrollFactor(0.5, 1)
        .setDepth(-2),
    );
    // 구름: 맵 폭에 고르게, 높이와 모양은 자리마다 정해진 값 (볼 때마다 같게)
    const count = Math.max(4, Math.round(width / 120));
    for (let i = 0; i < count; i++) {
      const far = i % 2 === 0;
      const x = (i + 0.3 + ((i * 7) % 5) / 10) * (width / count);
      const y = TILE_SIZE * (1.5 + ((i * 5) % 4) * 1.2);
      this.backdrop.push(
        this.add
          .image(x, y, `cloud-${i % 3}`)
          .setScrollFactor(far ? 0.3 : 0.6, 1)
          .setAlpha(far ? 0.8 : 1)
          .setDepth(far ? -3 : -1),
      );
    }
  }

  private clearBackdrop(): void {
    for (const object of this.backdrop) object.destroy();
    this.backdrop = [];
  }

  private updateZoom(): void {
    if (!this.layout) return;
    const { width, height } = this.scale.gameSize;
    this.zoomLevel = zoomFor(this.layout, width, height, this.zoomOffset);
    this.cameras.main.setZoom(this.zoomLevel);
  }

  /**
   * Ctrl +/−: 배율을 한 단계 올리거나 내린다 (정수 배율만). 바뀐 배율과, 기억해 둘 단계를 돌려준다.
   * 맵을 아직 그리지 않았으면 null.
   */
  zoomBy(step: 1 | -1): { zoom: number; offset: number } | null {
    if (!this.layout) return null;
    const { width, height } = this.scale.gameSize;
    this.zoomOffset = stepZoomOffset(this.layout, width, height, this.zoomOffset, step);
    this.updateZoom();
    return { zoom: this.zoomLevel, offset: this.zoomOffset };
  }

  /** 카메라 가운데: 내 캐릭터를 따라가되, 맵이 화면보다 작은 쪽은 맵 가운데에 둔다 */
  private cameraCenter(focus: Position | undefined): Position {
    const layout = this.layout!;
    const { width, height } = this.scale.gameSize;
    const axis = (mapPx: number, viewPx: number, target: number) => {
      const half = viewPx / this.zoomLevel / 2;
      if (mapPx <= half * 2) return mapPx / 2;
      return Math.min(Math.max(target, half), mapPx - half);
    };
    const fallback = { x: (layout.width * TILE_SIZE) / 2, y: (layout.height * TILE_SIZE) / 2 };
    const target = focus ?? fallback;
    return {
      x: axis(layout.width * TILE_SIZE, width, target.x),
      y: axis(layout.height * TILE_SIZE, height, target.y - CHARACTER_WORLD_HEIGHT / 2),
    };
  }

  private updateCamera(focus: Position | undefined): void {
    const center = this.cameraCenter(focus);
    this.cameras.main.centerOn(Math.round(center.x), Math.round(center.y));
  }

  private worldToScreen(p: Position): Position {
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    const cx = cam.scrollX + width / 2;
    const cy = cam.scrollY + height / 2;
    return {
      x: (p.x - cx) * this.zoomLevel + width / 2,
      y: (p.y - cy) * this.zoomLevel + height / 2,
    };
  }

  private screenToWorld(x: number, y: number): Position {
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    return {
      x: (x - width / 2) / this.zoomLevel + cam.scrollX + width / 2,
      y: (y - height / 2) / this.zoomLevel + cam.scrollY + height / 2,
    };
  }

  // ── 이름표와 말풍선 (DOM) ──

  private createActorDom(user: UserProfile, isMe: boolean) {
    const root = document.createElement('div');
    root.className = isMe ? 'plaza-actor plaza-actor--me' : 'plaza-actor';
    const bubbles = document.createElement('ol');
    bubbles.className = 'plaza-actor__bubbles';
    const name = document.createElement('span');
    name.className = 'plaza-actor__name';
    name.textContent = this.options.nameOf(user);
    const voice = document.createElement('span');
    voice.className = 'plaza-actor__voice';
    voice.hidden = true;
    root.append(bubbles, voice, name);
    this.options.overlay.append(root);
    return { root, bubbles, voice, name };
  }

  private updateOverlay(now: number): void {
    for (const actor of this.actors.values()) {
      const head = this.worldToScreen({
        x: actor.position.x,
        y: actor.position.y - CHARACTER_WORLD_HEIGHT - 1,
      });
      const { root } = actor.dom;
      root.style.transform = `translate(${Math.round(head.x)}px, ${Math.round(head.y)}px)`;
      root.style.zIndex = String(Math.round(actor.position.y));

      const active = activeBubbles(actor.bubbles, now);
      // 고친 메시지는 글이 바뀌므로 글까지 비교한다.
      const key = active.map((b) => `${b.id}:${b.text}`).join('\n');
      if (key !== actor.renderedBubbles) {
        actor.bubbles = active;
        actor.renderedBubbles = key;
        this.renderBubbles(actor.dom.bubbles, active);
        // 폭은 말풍선이 바뀔 때만 잰다 (매 프레임 재면 레이아웃을 계속 다시 계산한다).
        actor.bubblesWidth = actor.dom.bubbles.offsetWidth;
      }
      this.keepInside(actor, head.x);
    }
  }

  /** 캐릭터가 패널 가장자리에 있어도 말풍선이 잘리지 않게 안쪽으로 민다. 꼬리는 캐릭터를 가리킨다 */
  private keepInside(actor: Actor, x: number): void {
    const margin = 4;
    const half = actor.bubblesWidth / 2;
    const width = this.options.overlay.clientWidth;
    const shift =
      half === 0
        ? 0
        : Math.min(Math.max(x, margin + half), Math.max(margin + half, width - margin - half)) - x;
    const { bubbles } = actor.dom;
    bubbles.style.transform = shift ? `translateX(${Math.round(shift)}px)` : '';
    const tail = Math.max(-(half - 10), Math.min(half - 10, -shift));
    bubbles.style.setProperty('--tail-shift', `${Math.round(tail)}px`);
  }

  private renderBubbles(list: HTMLOListElement, bubbles: Bubble[]): void {
    list.replaceChildren(
      ...bubbles.map((b) => {
        const item = document.createElement('li');
        item.className =
          b.kind === 'attachment-emote' ? 'plaza-bubble plaza-bubble--emote' : 'plaza-bubble';
        if (b.label) {
          const label = document.createElement('span');
          label.className = 'plaza-bubble__label';
          label.textContent = b.label;
          item.append(label);
        }
        const text = document.createElement('span');
        text.className = 'plaza-bubble__text';
        if (b.icon) text.append(icon(b.icon === 'image' ? ImageIcon : Paperclip));
        text.append(b.text);
        item.append(text);
        return item;
      }),
    );
  }

  // ── 정리 ──

  private destroyActor(actor: Actor): void {
    actor.sprite.destroy();
    actor.shadow.destroy();
    actor.ring.destroy();
    actor.dom.root.remove();
  }

  private clearActors(): void {
    for (const actor of this.actors.values()) this.destroyActor(actor);
    this.actors.clear();
  }
}
