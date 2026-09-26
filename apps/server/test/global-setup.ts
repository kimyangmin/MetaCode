import { execSync } from 'node:child_process';
import { Redis } from 'ioredis';
import pg from 'pg';
import { testEnv } from './env.js';

/** 테스트 DB를 만들고(없으면) 마이그레이션을 적용한 뒤 비운다. */
export default async function setup() {
  const url = new URL(testEnv.DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const admin = new pg.Client({ connectionString: new URL('/postgres', url).href });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testEnv.DATABASE_URL },
    stdio: 'pipe',
  });

  const db = new pg.Client({ connectionString: testEnv.DATABASE_URL });
  await db.connect();
  await db.query('TRUNCATE users, refresh_tokens CASCADE');
  await db.end();

  const redis = new Redis(testEnv.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
