# Pas utilisé (nixpacks actif via railway.toml)
# kept for reference
FROM node:20-bookworm
WORKDIR /app
COPY package*.json ./
RUN npm ci && npx playwright install --with-deps chromium
COPY . .
ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]

