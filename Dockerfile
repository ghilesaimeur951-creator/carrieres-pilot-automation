# Diagnostic: node:20-bookworm sans chromium pour tester si Railway deploie
FROM node:20-bookworm

WORKDIR /app
COPY package*.json ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]
