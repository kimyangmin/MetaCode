import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// 모노레포 루트의 .env를 읽는다. CI처럼 환경변수가 이미 있으면 덮어쓰지 않는다.
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // prisma generate는 DB에 접속하지 않으므로 URL이 없어도 동작해야 한다.
    url: process.env.DATABASE_URL ?? '',
  },
});
