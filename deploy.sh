#!/usr/bin/env bash
#
# Deploy MF Maps. Run on the app server from anywhere:
#
#   /srv/mfmaps/deploy.sh
#
# Order matters. Migrations run against the NEW image but the OLD containers
# are still serving, so schema changes must be backwards-compatible with the
# running code for the few seconds before the swap. Adding tables and nullable
# columns is safe; dropping or renaming a column the live code still reads is
# not -- do those in two deploys.
#
# Both static volumes are removed every time because Docker only seeds a named
# volume from the image when the volume is empty. Skip this and you serve
# stale CSS forever with no error to tell you.

set -euo pipefail

REPO=/srv/mfmaps
COMPOSE="docker compose -f docker-compose.prod.yml"

cd "$REPO"

echo "==> Pulling"
git pull

APP_VERSION=$(git rev-parse --short HEAD)
export APP_VERSION
echo "==> Building $APP_VERSION"
$COMPOSE build --build-arg APP_VERSION="$APP_VERSION"

echo "==> Migrating content"
$COMPOSE run --rm content python manage.py migrate --noinput

echo "==> Migrating map"
$COMPOSE run --rm map python manage.py migrate --noinput

echo "==> Swapping containers"
$COMPOSE down
docker volume rm mfmaps_content_static mfmaps_map_static >/dev/null 2>&1 || true
$COMPOSE up -d

echo "==> Waiting for health"
sleep 5
$COMPOSE ps

echo
echo "Deployed $APP_VERSION"
echo "Logs:  cd $REPO && $COMPOSE logs -f --tail=50"