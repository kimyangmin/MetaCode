import { execSync } from 'node:child_process';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
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

  await resetBucket();
}

/** 테스트 전용 버킷을 만들고(없으면) 비운다. */
async function resetBucket() {
  const s3 = new S3Client({
    endpoint: testEnv.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: testEnv.S3_ACCESS_KEY, secretAccessKey: testEnv.S3_SECRET_KEY },
  });
  const Bucket = testEnv.S3_BUCKET;
  // 저장소가 막 떴을 때(CI)는 잠시 요청을 받지 못하므로 몇 번 다시 시도한다.
  for (let attempt = 1; ; attempt++) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket }));
      break;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') break;
      if (attempt >= 30) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  for (;;) {
    const list = await s3.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1000 }));
    const keys = list.Contents?.map((o) => ({ Key: o.Key! })) ?? [];
    if (keys.length === 0) break;
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }));
  }
  s3.destroy();
}
