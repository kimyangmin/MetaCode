/**
 * 메시지가 재가 되어 사라지는 연출 (메시지 삭제).
 * 1) 그을림: 회색으로 타 들어가고
 * 2) 부서짐: 왼쪽부터 부스러지며(마스크 + 변위 필터) 재·불씨 입자가 위로 날리고
 * 3) 접힘: 빈자리가 접힌다.
 * 그림을 찍지 않고(html2canvas 등) CSS 필터·마스크와 입자 캔버스만 쓴다.
 */

const BURN_MS = 260;
const CRUMBLE_MS = 760;
const COLLAPSE_MS = 220;
/** 연출 전체 길이. 이 뒤에 목록에서 뺀다 */
export const ASH_TOTAL_MS = BURN_MS + CRUMBLE_MS + COLLAPSE_MS;

/** 부서지는 경계(투명 → 불투명)의 폭, 마스크 그림 폭에 대한 비율 */
const MASK_SCALE = 2.5;
const MASK_EDGE_FROM = 0.4;
const MASK_EDGE_TO = 0.6;

/** 재(회색)와 가끔 섞이는 불씨(모닥불색) */
const ASH_COLORS = ['#3a3a3f', '#55555c', '#76767e', '#9a948c', '#b8b2aa'];
const EMBER_COLORS = ['#fdbe53', '#f08a3c'];
const EMBER_CHANCE = 0.12;

/** 메시지 크기에 맞춘 입자 수 (작은 메시지도 보이게, 큰 메시지도 가볍게) */
export function particleCount(width: number, height: number): number {
  return Math.round(Math.min(320, Math.max(60, (width * height) / 90)));
}

/**
 * 부서짐 진행(0~1)에 따른 경계의 x (메시지 왼쪽 기준). 마스크가 왼쪽부터 지워 가는 자리와 같다.
 * mask-size가 너비의 MASK_SCALE배이고 mask-position을 100% → 0%로 옮기므로,
 * 경계의 가운데는 -W/4(시작, 전부 보임)에서 1.25W(끝, 전부 지워짐)로 간다.
 */
export function crumbleEdgeX(progress: number, width: number): number {
  const p = 1 - progress; // mask-position x (1 → 0)
  const edgeCenter = ((MASK_EDGE_FROM + MASK_EDGE_TO) / 2) * MASK_SCALE * width;
  return edgeCenter - (MASK_SCALE - 1) * width * p;
}

const running = new Set<string>();

/**
 * 이 창에서 지우기를 요청한 메시지. 연출은 지운 사람에게만 보여 주고,
 * 다른 사람(다른 창)에게는 message:deleted를 받는 즉시 목록에서 뺀다.
 */
const ownDeletions = new Set<string>();

/** 지우기 요청을 보내기 전에 적어 둔다 (알림이 확인 응답보다 먼저 올 수 있으므로) */
export function markOwnDeletion(messageId: string): void {
  ownDeletions.add(messageId);
}

/** 지우기가 실패하면 지운다 */
export function forgetOwnDeletion(messageId: string): void {
  ownDeletions.delete(messageId);
}

/** message:deleted를 받았을 때: 이 창에서 지운 메시지면 표시를 지우고 true */
export function takeOwnDeletion(messageId: string): boolean {
  return ownDeletions.delete(messageId);
}
let filterSeq = 0;

/**
 * 화면에 보이는 그 메시지를 재로 만들어 사라지게 하고, 끝나면 resolve한다.
 * 메시지가 화면에 없거나, 창이 가려져 있거나, 움직임 줄이기 설정이면 바로 resolve한다.
 * 끝을 애니메이션 이벤트가 아니라 시간으로 재므로(가려진 창에서도) 목록에서 빼는 일이 멈추지 않는다.
 */
export function vanishMessage(messageId: string): Promise<void> {
  const el = document.querySelector<HTMLElement>(
    `.message-list [data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!el || running.has(messageId) || !shouldAnimate(el)) return Promise.resolve();
  running.add(messageId);
  const cleanup = play(el);
  return new Promise((resolve) => {
    setTimeout(() => {
      running.delete(messageId);
      cleanup();
      resolve();
    }, ASH_TOTAL_MS);
  });
}

function shouldAnimate(el: HTMLElement): boolean {
  if (document.hidden) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  // 접힌(inert) 채팅이나 스크롤해서 안 보이는 메시지는 그냥 뺀다.
  if (el.closest('[inert]')) return false;
  const rect = el.getBoundingClientRect();
  const list = el.closest('.message-list')?.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || !list) return false;
  return rect.bottom > list.top && rect.top < list.bottom;
}

/** 연출을 시작하고, 끝난 뒤 남은 것(필터 SVG)을 치우는 함수를 돌려준다 */
function play(el: HTMLElement): () => void {
  const rect = el.getBoundingClientRect();
  el.dataset.vanishing = 'true';

  // 부서질수록 픽셀이 흩어지게 하는 변위 필터 (메시지마다 하나, 끝나면 지움)
  const filterId = `ash-filter-${++filterSeq}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML = `<filter id="${filterId}" x="-10%" y="-30%" width="120%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${filterSeq}" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
  document.body.append(svg);
  const displacement = svg.querySelector('feDisplacementMap')!;

  const charred = 'grayscale(1) sepia(0.45) brightness(0.62) contrast(1.15)';
  // 1) 그을림
  const burn = el.animate([{ filter: 'none' }, { filter: charred }], {
    duration: BURN_MS,
    easing: 'ease-in',
    fill: 'forwards',
  });

  // 2) 부서짐: 왼쪽부터 지우는 마스크 + 점점 커지는 변위 + 입자
  const crumbleStart = performance.now() + BURN_MS;
  const mask = `linear-gradient(90deg, transparent ${MASK_EDGE_FROM * 100}%, #000 ${MASK_EDGE_TO * 100}%)`;
  el.style.setProperty('mask-image', mask);
  el.style.setProperty('-webkit-mask-image', mask);
  el.style.setProperty('mask-size', `${MASK_SCALE * 100}% 100%`);
  el.style.setProperty('-webkit-mask-size', `${MASK_SCALE * 100}% 100%`);
  el.style.setProperty('mask-repeat', 'no-repeat');
  el.style.setProperty('-webkit-mask-repeat', 'no-repeat');
  el.animate(
    [
      { maskPosition: '100% 0', WebkitMaskPosition: '100% 0' },
      { maskPosition: '0% 0', WebkitMaskPosition: '0% 0' },
    ],
    { delay: BURN_MS, duration: CRUMBLE_MS, easing: 'ease-in', fill: 'both' },
  );
  // 그을린 뒤에는 변위 필터를 더한다. 채워 둔(fill) 애니메이션은 인라인 스타일보다 앞서므로 끝낸다.
  const filterTimer = setTimeout(() => {
    el.style.filter = `url(#${filterId}) ${charred}`;
    burn.cancel();
  }, BURN_MS);

  const stopParticles = runParticles(rect, crumbleStart, (t) => {
    displacement.setAttribute('scale', String(Math.round(22 * t * t)));
  });

  // 3) 접힘: 높이·여백을 0으로 (아래 메시지가 자연스럽게 따라온다)
  const style = getComputedStyle(el);
  el.animate(
    [
      {
        height: `${el.offsetHeight}px`,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
      },
      {
        height: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        marginTop: '0px',
        marginBottom: '0px',
      },
    ],
    {
      delay: BURN_MS + CRUMBLE_MS,
      duration: COLLAPSE_MS,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards',
    },
  );

  return () => {
    clearTimeout(filterTimer);
    stopParticles.stopSpawning();
    svg.remove();
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  ember: boolean;
  born: number;
  life: number;
  wobble: number;
}

/**
 * 메시지 위에 겹친 캔버스에서 입자를 날린다. 부서지는 경계를 따라 생겨 오른쪽 위로 흩날리며 사라진다.
 * onCrumble(t)는 부서짐 진행(0~1)마다 불린다. 입자가 모두 사라지면 캔버스를 스스로 지운다.
 */
function runParticles(
  rect: DOMRect,
  crumbleStart: number,
  onCrumble: (t: number) => void,
): { stopSpawning(): void } {
  const PAD_X = 80;
  const PAD_TOP = 90;
  const PAD_BOTTOM = 20;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = rect.width + PAD_X * 2;
  const height = rect.height + PAD_TOP + PAD_BOTTOM;
  const canvas = document.createElement('canvas');
  canvas.className = 'ash-canvas';
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = `left:${rect.left - PAD_X}px;top:${rect.top - PAD_TOP}px;width:${width}px;height:${height}px`;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return { stopSpawning() {} };
  }
  ctx.scale(dpr, dpr);

  const total = particleCount(rect.width, rect.height);
  const particles: Particle[] = [];
  let spawned = 0;
  let spawning = true;
  let last = performance.now();

  const spawn = (now: number, edgeX: number) => {
    const ember = Math.random() < EMBER_CHANCE;
    const palette = ember ? EMBER_COLORS : ASH_COLORS;
    particles.push({
      // 경계 근처(조금 앞뒤로 퍼지게), 메시지 높이 안
      x: PAD_X + edgeX + (Math.random() - 0.5) * 24,
      y: PAD_TOP + Math.random() * rect.height,
      vx: 25 + Math.random() * 70,
      vy: -(20 + Math.random() * 70),
      size: ember ? 1 + Math.random() * 1.5 : 1 + Math.random() * 2.5,
      color: palette[Math.floor(Math.random() * palette.length)]!,
      ember,
      born: now,
      life: 550 + Math.random() * 650,
      wobble: Math.random() * Math.PI * 2,
    });
    spawned++;
  };

  const frame = (now: number) => {
    const dt = Math.min(48, now - last) / 1000;
    last = now;
    const t = Math.min(1, Math.max(0, (now - crumbleStart) / CRUMBLE_MS));
    if (now >= crumbleStart) onCrumble(t);
    // 진행만큼 입자를 낸다 (부서진 만큼 재가 생김)
    if (spawning && now >= crumbleStart) {
      const due = Math.min(total, Math.round(total * Math.min(1, t * 1.1)));
      const edgeX = Math.max(0, Math.min(rect.width, crumbleEdgeX(t, rect.width)));
      while (spawned < due) spawn(now, edgeX);
    }

    ctx.clearRect(0, 0, width, height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      const age = (now - p.born) / p.life;
      if (age >= 1) {
        particles.splice(i, 1);
        continue;
      }
      // 위로 떠오르며 살짝 흔들리고, 공기 저항으로 느려진다
      p.wobble += dt * 6;
      p.x += (p.vx + Math.sin(p.wobble) * 18) * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 0.8;
      p.vy -= 12 * dt;
      ctx.globalAlpha = (1 - age) * (p.ember ? 1 : 0.85);
      ctx.fillStyle = p.color;
      const s = p.size * (p.ember ? 1 : 1 - age * 0.4);
      ctx.fillRect(p.x, p.y, s, s);
    }
    ctx.globalAlpha = 1;

    const spawnDone = !spawning || spawned >= total || now > crumbleStart + CRUMBLE_MS;
    if (spawnDone && particles.length === 0) {
      canvas.remove();
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    stopSpawning() {
      spawning = false;
    },
  };
}
