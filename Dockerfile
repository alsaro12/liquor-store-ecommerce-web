FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY local-db/*.js ./local-db/
COPY scripts ./scripts
COPY src ./src
COPY dist ./dist
COPY productos_db.js ./
COPY server.js ./
COPY firebase.json ./
COPY firestore.rules ./
COPY storage.rules ./

CMD ["npm", "start"]
