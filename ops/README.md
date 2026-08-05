# ops/ — TLS renewal and monitoring

These files are the source of truth. They are **not** live where they sit —
each has to be copied to a path outside the repo. `deploy.sh` does not touch
them. After editing anything here, re-run the install below.

## Why this exists

In August 2026 the production cert expired and took the site down. Certbot's
systemd timer had been firing daily for 30 days and failing every time, silently:
`www.mfmaps.com`'s port-80 server block had a **server-level** `return 301`, and
nginx runs server-level rewrite directives before it selects a location, so the
`/.well-known/acme-challenge/` location was never reached. The challenge got
redirected to the bare domain, proxied to Django, and 404'd. All three domains
are on one cert, so www failing failed the whole renewal.

Two separate faults, both of which had to be fixed:

1. **Renewal failed.** Fixed in `nginx/nginx.conf` — the www redirect now lives
   inside `location /`, with the ACME location above it.
2. **Nothing reloaded nginx.** Certbot runs on the host; nginx runs in a
   container and reads cert files only at startup or reload. A renewed cert sits
   on disk unused until then. Fixed by the deploy hook below. This one produces
   no error at all — the cert renews, everything looks healthy, and the site goes
   down 90 days later anyway.

## Files

| File | Install to | Purpose |
|---|---|---|
| `reload-nginx.sh` | `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` | Reloads the nginx container after a successful renewal |
| `check-cert-expiry.sh` | `/usr/local/bin/check-cert-expiry.sh` | Daily expiry check, all three hostnames |
| `mfmaps-cert-check.cron` | `/etc/cron.d/mfmaps-cert-check` | Runs the check at 06:15 UTC |
| `mfmaps-cert-check.env.example` | `/etc/mfmaps-cert-check.env` (chmod 600) | Healthchecks ping URL — **not in git** |

## Install / reinstall

```bash
cd /srv/mfmaps
sudo install -m 755 ops/reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo install -m 755 ops/check-cert-expiry.sh /usr/local/bin/check-cert-expiry.sh
sudo install -m 644 ops/mfmaps-cert-check.cron /etc/cron.d/mfmaps-cert-check
# then create /etc/mfmaps-cert-check.env from the .example and chmod 600
```

`/etc/cron.d` files are ignored without complaint if they aren't `644 root:root`
or if the filename contains a dot. Verify with `ls -l`.

## Monitoring

`check-cert-expiry.sh` inspects the cert **served over the network**, not the
file on disk. That is deliberate: fault 2 above makes "renewed on disk" and
"actually served" diverge, and a disk check reports healthy through the entire
outage window.

It pings Healthchecks.io (`mfmaps-cert-expiry`, period 1 day / grace 2 days) on
success and `/fail` with detail below 20 days remaining. Because it pings on
*success*, the check failing to run at all is itself an alert. A monitor that
only speaks up on bad news is indistinguishable from a dead one — which is the
mistake that caused this outage.

## Verify

```bash
sudo /usr/local/bin/check-cert-expiry.sh; echo "EXIT: $?"   # expect 0
sudo certbot renew --dry-run --run-deploy-hooks             # expect success
```

The dry run reports the hook as "ran with error output" on success. That is
nginx writing `[notice] signal process started` to stderr; certbot reports any
stderr from a hook that way. A real hook failure fails the renewal.

## First cert on a new server

See the header comment in `docker-compose.bootstrap.yml`.
