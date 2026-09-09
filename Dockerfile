# Multi-stage: build the site and bundle the server, then ship only the runtime pieces.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/server-node/package.json packages/server-node/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
# build:site sets VITE_MULTIPLAYER_URL to "" = same origin (apps/web/src/multiplayer/config.ts).
RUN npm run build:site && npm run build --workspace @arcs/server-node

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3070 \
    DATABASE_PATH=/data/arcs.db \
    STATIC_DIR=/app/web
COPY --from=build /app/packages/server-node/dist/main.js ./server/main.js
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /data && echo '{"type":"module"}' > /app/server/package.json
VOLUME ["/data"]
EXPOSE 3070
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3070/healthz || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "server/main.js"]
