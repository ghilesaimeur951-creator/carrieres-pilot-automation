FROM node:20-bookworm-slim

# Dependances systeme pour Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

ENV PORT=3001
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3001
CMD ["node", "server.js"]
