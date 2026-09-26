# Caddy + 웹 빌드 결과. 빌드 컨텍스트는 저장소 루트다.
FROM node:24.21.0-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@metacode/web..."

COPY packages/shared packages/shared
COPY apps/web apps/web
# API 주소는 빌드할 때 웹 코드에 들어간다.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL} WEB_BASE=/
RUN test -n "$VITE_API_URL" && pnpm --filter "@metacode/web..." build

FROM caddy:2.11.4-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/web
