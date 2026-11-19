# AEZ Stock Exchange: one image serving the API, Socket.IO and the built web app (same origin).
# Railway builds this automatically (see railway.json). PostgreSQL is a separate Railway service.

FROM node:24.11.1-bookworm-slim AS build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
COPY data data
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:24.11.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TRUST_PROXY=true
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/server/package.json apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /app/apps/server/drizzle apps/server/drizzle
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
COPY --from=build --chown=node:node /app/data data
USER node
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
