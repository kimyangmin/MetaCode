# 서버 이미지. 빌드 컨텍스트는 저장소 루트다 (infra/docker-compose.prod.yml 참고).
FROM node:24.21.0-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# 매니페스트만 먼저 복사해 의존성 설치를 캐시한다.
# lockfile 검사를 위해 워크스페이스의 모든 package.json이 필요하다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@metacode/server..."

COPY packages/shared packages/shared
COPY apps/server apps/server
# shared → server 순서로 빌드한다 (server build가 prisma generate도 실행).
RUN pnpm --filter "@metacode/server..." build
# 운영 의존성만 모은 실행용 디렉터리를 만든다.
RUN pnpm deploy --legacy --filter @metacode/server --prod /out

# DB 마이그레이션을 적용하고 끝나는 일회성 이미지 (prisma CLI가 필요해 build 단계를 그대로 쓴다)
FROM build AS migrate
WORKDIR /repo/apps/server
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
