FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    WWEBJS_AUTH_PATH=/app/.wwebjs_auth \
    WWEBJS_CACHE_PATH=/app/.wwebjs_cache

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      curl \
      dumb-init \
      fonts-liberation \
      fonts-noto-color-emoji \
      fonts-noto-core \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN chromium --version

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache \
    && chown -R node:node /app

VOLUME ["/app/.wwebjs_auth", "/app/.wwebjs_cache"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3000/health > /dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
