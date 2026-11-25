FROM node:22-alpine

# Zona horaria de Chile para que las reglas de horario usen la hora local
RUN apk add --no-cache tzdata
ENV TZ=America/Santiago \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Carpeta para los archivos de eventos archivados (npm run eventos:archivar)
RUN mkdir -p /app/archivo && chown node:node /app/archivo

# La aplicación no corre como root
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-3000}/health || exit 1
CMD ["node", "src/server.js"]
