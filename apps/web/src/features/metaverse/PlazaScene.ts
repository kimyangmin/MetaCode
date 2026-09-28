import {
  type AssetManifest,
  type AssetRef,
  type Direction,
  MOVE_SEND_INTERVAL_MS,
  type MapDefinition,
  type MapLayout,
  type PlazaCorrection,
  type PlazaMoved,
  type PlazaOccupant,
  type PlazaSnapshot,
  type Position,
  TILE_SIZE,
  type UserProfile,
  buildCollision,
} from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import Phaser from 'phaser';
import { drawShadow, drawSpeakingRing, drawTargetMarker } from './art';
import { type Bubble, activeBubbles, pushBubble } from './bubbles';
import { zoomFor } from './camera';
import {
  type CharacterLook,
  animationName,
  characterFrame,
  characterLook,
  emoteDurationMs,
} from './characterSprite';
import { RemoteTrack, directionOf, stepByInput, stepToward } from './motion';
import { MapView } from './mapView';
import { findPath, tileCenter } from './pathfinding';

const CHARACTER_HEIGHT = 32;
/** 이만큼 움직이지 않아야 걷기를 멈춘다 (받은 위치 사이에서 걷기 모션이 끊겼다 이어지지 않게) */
const WALK_HOLD_MS = 120;
export interface MoveState extends Position {
  dir: Direction;
  moving: boolean;
}

/** 통화 중인 캐릭터에 보일 것: 참여 중인 음성 채널, 말하는 중, 음소거 */
export interface ActorVoice {
  label: string;
  speaking: boolean;
  muted: boolean;
}

export interface PlazaSceneOptions {
  meId: string;
  /** 캐릭터 위의 이름표와 말풍선을 올릴 DOM 층 (글자는 화면 해상도로 그린다) */
  overlay: HTMLElement;
  nameOf(user: UserProfile): string;
  /** 내 캐릭터 위치를 서버에 보낸다 */
  onMove(state: MoveState): void;
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
  lastMovedAt: number;
  bubbles: Bubble[];
  renderedBubbles: string;
  bubblesWidth: number;
  /** 첨부 모션이 끝나는 시각 */
  emoteUntil: number;
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
  private map: { key: string; view: MapView } | null = null;
  /** 서버에서 받은 에셋(직접 그린 캐릭터 등). 내장 에셋은 builtinAsset으로 찾는다 */
  private readonly customAssets = new Map<AssetRef, AssetManifest>();
  private readonly assetOf = (ref: AssetRef) => this.customAssets.get(ref) ?? builtinAsset(ref);
  private actors = new Map<string, Actor>();
  private path: Position[] = [];
  private marker: Phaser.GameObjects.Image | null = null;
  private voice: ReadonlyMap<string, ActorVoice> = new Map();
  private lastSent: (MoveState & { at: number }) | null = null;
  private zoomLevel = 2;
  /** 눌려 있는 방향키. PlazaView가 광장 패널에 포커스가 있을 때만 넣는다 */
  private readonly held = new Set<string>();
  /** 지난 프레임 이후 눌린 키. 프레임 사이에 눌렀다 뗀 짧은 입력도 한 걸음은 움직이게 한다 */
  private readonly tapped = new Set<string>();

  constructor(options: PlazaSceneOptions) {
    super('plaza');
    this.options = options;
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
    this.cameras.main.setRoundPixels(true);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.updateZoom());
    this.updateZoom();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return;
      this.walkTo(this.screenToWorld(pointer.x, pointer.y));
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearActors();
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
    this.lastSent = null;
    for (const occupant of snapshot.occupants) this.upsert(occupant);
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
      sprite: this.add
        .image(
          position.x,
          position.y,
          look.key,
          characterFrame(look.manifest, `idle-${occupant.dir}`, occupant.dir, 0),
        )
        .setOrigin(0.5, 1),
      look,
      animation: { name: `idle-${occupant.dir}`, start: 0 },
      position,
      dir: occupant.dir,
      track: isMe ? null : new RemoteTrack(position, performance.now()),
      walking: false,
      lastMovedAt: 0,
      bubbles: [],
      renderedBubbles: '',
      bubblesWidth: 0,
      emoteUntil: 0,
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
  }

  /** 서버가 내 이동을 받아들이지 않았다: 그 자리로 되돌린다 */
  corrected(correction: PlazaCorrection): void {
    const me = this.actors.get(this.options.meId);
    if (!me) return;
    me.position = { x: correction.x, y: correction.y };
    me.dir = correction.dir;
    this.path = [];
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
    actor.dom.voice.textContent = state ? `${state.label}${state.muted ? ' 🔇' : ''}` : '';
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
    this.sendMove(me, now);
  }

  /** 움직이는 동안은 일정 간격으로, 멈추면 한 번 더 (멈춘 자리) 보낸다 */
  private sendMove(me: Actor, now: number): void {
    const state: MoveState = { ...me.position, dir: me.dir, moving: me.walking };
    const last = this.lastSent;
    if (me.walking) {
      if (last && now - last.at < MOVE_SEND_INTERVAL_MS) return;
    } else if (!last?.moving) {
      return;
    }
    this.lastSent = { ...state, at: now };
    this.options.onMove(state);
  }

  private walkTo(target: Position): void {
    const me = this.actors.get(this.options.meId);
    if (!me || !this.layout) return;
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

  private renderActor(actor: Actor, now: number): void {
    const { x, y } = actor.position;
    if (actor.walking) actor.lastMovedAt = now;
    const name = animationName(
      {
        dir: actor.dir,
        walking: now - actor.lastMovedAt < WALK_HOLD_MS,
        emoteUntil: actor.emoteUntil,
      },
      now,
    );
    if (actor.animation.name !== name) actor.animation = { name, start: now };
    const { manifest } = actor.look;
    actor.sprite.setFrame(characterFrame(manifest, name, actor.dir, now - actor.animation.start));
    // 첨부 모션 동안에는 제자리에서 뛴다.
    const lift =
      actor.emoteUntil > now
        ? Math.round(Math.abs(Math.sin((actor.emoteUntil - now) / 60)) * 4)
        : 0;
    actor.sprite.setPosition(x, y - lift).setDepth(y);
    actor.shadow.setPosition(x, y).setDepth(1);
    if (actor.ring.visible) {
      actor.ring.setPosition(x, y + 1).setDepth(1.5);
      actor.ring.setAlpha(0.6 + 0.4 * Math.sin(now / 150));
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
    this.layout = buildCollision(definition, this.assetOf);
    this.map = { key, view: new MapView(this, definition, this.assetOf) };
    this.updateZoom();
  }

  private updateZoom(): void {
    if (!this.layout) return;
    const { width, height } = this.scale.gameSize;
    this.zoomLevel = zoomFor(this.layout, width, height);
    this.cameras.main.setZoom(this.zoomLevel);
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
      y: axis(layout.height * TILE_SIZE, height, target.y - CHARACTER_HEIGHT / 2),
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
        y: actor.position.y - CHARACTER_HEIGHT - 1,
      });
      const { root } = actor.dom;
      root.style.transform = `translate(${Math.round(head.x)}px, ${Math.round(head.y)}px)`;
      root.style.zIndex = String(Math.round(actor.position.y));

      const active = activeBubbles(actor.bubbles, now);
      const key = active.map((b) => b.id).join(',');
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
        text.textContent = b.text;
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
