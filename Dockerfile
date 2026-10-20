FROM node:lts-bullseye-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build && npm prune --omit=dev

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js"]
