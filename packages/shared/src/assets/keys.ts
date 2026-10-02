/**
 * 에셋 매니페스트와 애니메이터가 함께 쓰는 이름 규칙. manifest.ts와 animator.ts가 서로를 불러오지 않게
 * 따로 둔다 (manifest.ts가 다시 내보낸다).
 */

/** 애니메이션·애니메이터 상태·파라미터 이름 (영문 소문자로 시작, 소문자·숫자·-) */
export const ASSET_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * 캐릭터 모션: 필수 애니메이션 말고 직접 추가해서 광장에서 숫자 키로 트는 애니메이션 (춤, 인사 등).
 * 키는 숫자 1~9, 0이라 한 캐릭터에 열 개까지다 (애니메이터 파라미터의 키와 함께 센다).
 */
export const MOTION_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
export type MotionKey = (typeof MOTION_KEYS)[number];
export const MOTION_LABEL_MAX_LENGTH = 16;

/**
 * 애니메이터 파라미터(스킬)에만 달 수 있는 글자 키. 광장은 방향키·스페이스·/만 쓰므로 겹치지 않고, 한글
 * 자판이어도 자리(e.code)로 본다. 숫자 키는 모션과 파라미터가 함께 쓴다.
 */
export const SKILL_KEYS = ['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r'] as const;
/** 애니메이터 파라미터에 달 수 있는 키 (숫자 키 + 글자 키). 광장의 모션 목록도 이 순서로 보인다 */
export const PARAMETER_KEYS = [...MOTION_KEYS, ...SKILL_KEYS] as const;
export type ParameterKey = (typeof PARAMETER_KEYS)[number];
