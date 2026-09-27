/**
 * 테스트 전용 환경. 개발 DB를 건드리지 않도록 별도 DB(metacode_test)와 Redis DB 1을 쓴다.
 * CI는 TEST_DATABASE_URL / TEST_REDIS_URL로 바꿀 수 있다.
 */
export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://metacode:metacode@localhost:5433/metacode_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  PUBLIC_SERVER_URL: 'http://localhost:3000',
  WEB_ORIGIN: 'http://localhost:5173',
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
  S3_BUCKET: 'metacode-test',
  S3_ACCESS_KEY: 'metacode',
  S3_SECRET_KEY: 'metacode-secret',
  // 크기 제한을 빨리 확인할 수 있게 작게 둔다.
  UPLOAD_MAX_SIZE_MB: '1',
};
