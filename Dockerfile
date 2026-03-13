FROM node:20-bookworm-slim

WORKDIR /app

# Xvfb pour faire tourner Chrome en mode non-headless (contourne les checks Cloudflare GPU/WebGL)
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci && npx playwright install chromium --with-deps

COPY server.js start.sh ./
RUN chmod +x start.sh

CMD ["./start.sh"]
