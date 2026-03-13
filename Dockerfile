FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

WORKDIR /app
COPY package*.json ./

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

ENV PORT=3001
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3001
CMD ["node", "server.js"]
