import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import type { ServerOptions } from 'socket.io';
import type { Env } from './config/env.js';

/**
 * 요청 본문 한도. 에셋 매니페스트를 JSON으로 그대로 받으므로 express 기본값(100KB)으로는 모자란다.
 * 에셋의 프레임 데이터는 ASSET_ENCODED_MAX(약 400만 글자)까지다 (256×512 캐릭터도 도트 그림이면 RLE로 훨씬 작다).
 */
const BODY_LIMIT = '6mb';

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
