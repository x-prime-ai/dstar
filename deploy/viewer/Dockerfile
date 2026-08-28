# Build from the repository root. The allowlisted context excludes documents,
# credentials, Git state and the legacy workspace server.
FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN npm install --global pnpm@10.28.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine ./packages/engine
COPY apps/viewer ./apps/viewer
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @dstar/engine build
RUN pnpm --filter @dstar/viewer --prod deploy --legacy /runtime

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /runtime ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "src/start.mjs"]
