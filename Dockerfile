FROM node:20-slim

# Installer Chromium et ses dependances systeme
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./

# Ne pas telecharger le navigateur Playwright (on utilise Chromium systeme)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

ENV PORT=3001
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3001
CMD ["node", "server.js"]
