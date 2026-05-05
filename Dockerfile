FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js schema.sql importar-json.js inventario_computadores.json ./
COPY public ./public/

ENV NODE_ENV=production

CMD ["node", "server.js"]
