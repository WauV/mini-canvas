ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim

FROM ${NODE_IMAGE} AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY app ./app
COPY livesync-bridge ./livesync-bridge
COPY mcp-server ./mcp-server
COPY widget ./widget
COPY scripts/init-couchdb-container.ts ./scripts/init-couchdb-container.ts
COPY tsconfig.json vite.widget.config.ts postcss.config.mjs ./

RUN npm run widget:build \
  && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/livesync-bridge ./livesync-bridge
COPY --from=builder /app/mcp-server ./mcp-server
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p /data \
  && chown -R node:node /app /data

USER node

FROM runtime AS livesync-bridge
EXPOSE 3210
CMD ["node", "--experimental-strip-types", "livesync-bridge/src/cli.ts", "serve"]

FROM runtime AS mcp-server
EXPOSE 3220
VOLUME ["/data"]
CMD ["node", "--experimental-strip-types", "mcp-server/src/cli.ts", "serve"]
