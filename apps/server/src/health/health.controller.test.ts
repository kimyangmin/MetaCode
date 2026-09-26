import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('서버 상태를 ok로 응답한다', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });
});
