#!/usr/bin/env bash
# Certbot runs on the host; nginx runs in a container and only reads cert
# files at startup or reload. Without this hook a renewed cert sits on disk
# unused until the old one expires.
set -euo pipefail
cd /srv/mfmaps
docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload
