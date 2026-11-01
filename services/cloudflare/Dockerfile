FROM node:24.20.0-trixie-slim

RUN set -eux; \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; chmod 755 /usr/sbin/policy-rc.d; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg tini chromium chromium-sandbox fonts-liberation; \
    curl --fail --show-error --location --connect-timeout 15 --max-time 60 \
      https://deb.torproject.org/torproject.org/A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89.asc -o /tmp/tor-signing-key.asc; \
    test "$(gpg --show-keys --with-colons /tmp/tor-signing-key.asc | awk -F: '$1 == "fpr" { print $10; exit }')" = A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89; \
    gpg --batch --dearmor --output /usr/share/keyrings/deb.torproject.org-keyring.gpg /tmp/tor-signing-key.asc; \
    printf '%s\n' 'Types: deb' 'URIs: https://deb.torproject.org/torproject.org/' 'Suites: trixie' 'Components: main' 'Signed-By: /usr/share/keyrings/deb.torproject.org-keyring.gpg' > /etc/apt/sources.list.d/tor.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends tor deb.torproject.org-keyring; \
    rm -f /tmp/tor-signing-key.asc; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/cloudflare/package.json services/cloudflare/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY services/intelligence/*.mjs ./services/intelligence/
COPY services/cloudflare/container/ ./services/cloudflare/container/
COPY services/cloudflare/src/controller.mjs ./services/cloudflare/src/controller.mjs
RUN mkdir -p /tmp/intelligence-tor && chmod 700 /tmp/intelligence-tor && chown -R node:node /app /tmp/intelligence-tor
USER node
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    TOR_SOCKS_PROXY=socks5://127.0.0.1:9050 \
    INTELLIGENCE_WORKER_HOST=0.0.0.0 \
    INTELLIGENCE_WORKER_PORT=43410
EXPOSE 43410
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "node", "services/cloudflare/container/entrypoint.mjs"]
