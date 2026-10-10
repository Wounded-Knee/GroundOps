FROM node:22-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY patches patches

RUN pnpm install --frozen-lockfile --filter @groundops/server...

COPY apps/server apps/server
COPY packages/contracts packages/contracts
COPY --chmod=755 docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh

WORKDIR /app/apps/server
ENV PORT=3000
EXPOSE 3000
USER node
ENTRYPOINT ["api-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/index.ts"]
