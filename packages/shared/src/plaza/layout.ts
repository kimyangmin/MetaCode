/** 타일 한 칸 (px). 도트 에셋 규격: 타일 16×16, 캐릭터 16×32 */
export const TILE_SIZE = 16;

/**
 * 이동 검증과 길찾기가 쓰는 충돌 격자. 맵 정의(MapDefinition)에서 buildCollision으로 만든다.
 * 서버와 클라이언트가 같은 맵 정의에서 같은 격자를 만든다 (설계 원칙: 이동은 서버가 검증한다).
 */
export interface MapLayout {
  /** 타일 단위 */
  width: number;
  height: number;
  /** 타일별 통행 불가 여부 (row-major, width × height) */
  blocked: Uint8Array;
  /** 처음 나타나는 영역 (타일 단위) */
  spawn: { x: number; y: number; w: number; h: number };
}
