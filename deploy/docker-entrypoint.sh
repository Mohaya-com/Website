#!/bin/sh
# Applies database migrations, then starts the web app (or runs a maintenance command).
#   web          (default) migrate + start the server on :3000
#   migrate      apply migrations only
#   create-admin create an administrator (interactive): create-admin --username admin --name "..."
#   maintenance  run the lifecycle sweep once
set -e
cd /app

case "$1" in
  web)
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      pnpm --silent --filter @vms/db migrate
    fi
    exec pnpm --silent --filter @vms/web exec next start --hostname 0.0.0.0 --port "${PORT:-3000}"
    ;;
  migrate)
    exec pnpm --silent --filter @vms/db migrate
    ;;
  create-admin)
    shift
    exec pnpm --silent --filter @vms/server exec tsx src/scripts/create-admin.ts "$@"
    ;;
  maintenance)
    exec pnpm --silent --filter @vms/server exec tsx src/scripts/maintenance.ts
    ;;
  *)
    exec "$@"
    ;;
esac
