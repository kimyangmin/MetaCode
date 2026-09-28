import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import type { ServerOptions } from 'socket.io';
import type { Env } from './config/env.js';

/**
 * 요청 본문 한도. 에셋 매니페스트를 JSON으로 그대로 받으므로 express 기본값(100KB)으로는 모자란다.
 * 가장 큰 에셋(ASSET_PIXEL_BUDGET = 128×256 × 32프레임)이 base64로 약 1.4MB다.
 */
const BODY_LIMIT = '2mb';

/** main.ts와 테스트가 같은 설정으로 앱을 띄우도록 공통 설정을 한 곳에 둔다. */
export function setupApp(app: NestExpressApplication): void {
  const webOrigin = app.get(ConfigService<Env, true>).get('WEB_ORIGIN', { infer: true });
  const cors = { origin: webOrigin, credentials: true };

  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.use(cookieParser());
  app.enableCors(cors);
  app.useWebSocketAdapter(new CorsIoAdapter(app, cors));
  app.enableShutdownHooks();
}

class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly cors: ServerOptions['cors'],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: this.cors } as ServerOptions);
  }
}
