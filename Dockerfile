# Image officielle Playwright avec Chromium + Xvfb intégrés
FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Installer Chromium via Playwright
RUN npx playwright install chromium

COPY . .

ENV PORT=3001
EXPOSE 3001

# xvfb-run démarre un écran virtuel (nécessaire pour headless=false)
CMD ["xvfb-run", "--server-args=-screen 0 1280x720x24 -ac", "node", "server.js"]
