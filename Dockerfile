FROM mcr.microsoft.com/playwright:v1.42.0-focal

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY server.js .

CMD ["node", "server.js"]
