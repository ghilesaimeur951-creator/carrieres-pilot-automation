FROM mcr.microsoft.com/playwright:v1.42.0-focal

WORKDIR /app

COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
RUN npm ci

COPY . .

CMD ["node", "server.js"]

