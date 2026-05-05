# Imagem apenas para aplicar schema e importar inventario_computadores.json.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY db.js schema.sql inventario_computadores.json importar-json.js ./

ENV NODE_ENV=production

CMD ["node", "importar-json.js"]
