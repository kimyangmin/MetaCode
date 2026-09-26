import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import type { ServerOptions } from 'socket.io';
import type { Env } from './config/env.js';

/** main.ts와 테스트가 같은 설정으로 앱을 띄우도록 공통 설정을 한 곳에 둔다. */
export function setupApp(app: INestApplication): void {
  const webOrigin = app.get(ConfigService<Env, true>).get('WEB_ORIGIN', { infer: true });
  const cors = { origin: webOrigin, credentials: true };

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
