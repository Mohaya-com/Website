# Production image for the web app + shared API (build from the repository root):
#   docker build -f apps/web/Dockerfile -t compound-vms-web .
# Only the web app and its workspace dependencies are installed (the mobile app is excluded).

FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/server/package.json packages/server/
# The repository uses a hoisted node_modules layout for React Native; the server image uses pnpm's
# isolated layout so that only the web app's dependency graph is installed.
RUN pnpm install --frozen-lockfile --config.node-linker=isolated --filter "@vms/web..."

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN VMS_DISABLE_MAINTENANCE=true pnpm --filter @vms/web build && rm -rf apps/web/.next/cache

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH PORT=3000
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["web"]
