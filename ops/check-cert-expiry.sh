#!/usr/bin/env bash
#
# Daily TLS expiry check for mfmaps. Pings Healthchecks.io on success so that
# the check failing to run is itself an alert -- a monitor that only speaks up
# on bad news looks identical to a dead monitor.
#
# Checks the cert served over the network, NOT the file on disk. Certbot runs
# on the host but nginx runs in a container and only reads cert files at
# reload, so "renewed on disk" and "actually being served" can diverge for
# weeks. Only the wire tells the truth.

set -uo pipefail

ENV_FILE="/etc/mfmaps-cert-check.env"
if [ ! -r "$ENV_FILE" ]; then
    echo "missing $ENV_FILE -- see ops/mfmaps-cert-check.env.example" >&2
    exit 2
fi
# shellcheck source=/dev/null
. "$ENV_FILE"
HOSTS="mfmaps.com www.mfmaps.com map.mfmaps.com"
MIN_DAYS=20

now=$(date +%s)
problems=""
summary=""

for h in $HOSTS; do
    end=$(echo | openssl s_client -connect "${h}:443" -servername "$h" 2>/dev/null \
          | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

    if [ -z "$end" ]; then
        problems="${problems}${h}: could not retrieve certificate"$'\n'
        continue
    fi

    end_ts=$(date -d "$end" +%s 2>/dev/null)
    if [ -z "$end_ts" ]; then
        problems="${problems}${h}: unparseable expiry date '${end}'"$'\n'
        continue
    fi

    days=$(( (end_ts - now) / 86400 ))
    summary="${summary}${h}: ${days}d (${end})"$'\n'

    if [ "$days" -lt "$MIN_DAYS" ]; then
        problems="${problems}${h}: expires in ${days} days"$'\n'
    fi
done

if [ -n "$problems" ]; then
    curl -fsS -m 10 --retry 3 --data-raw "FAIL:"$'\n'"${problems}"$'\n'"${summary}" \
        "${PING_URL}/fail" >/dev/null
    echo "$problems"
    exit 1
fi

curl -fsS -m 10 --retry 3 --data-raw "OK:"$'\n'"${summary}" "$PING_URL" >/dev/null
echo "$summary"
