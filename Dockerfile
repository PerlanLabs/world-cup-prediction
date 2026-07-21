FROM node:24-slim

WORKDIR /app

COPY world-cup-command-center/package*.json ./world-cup-command-center/
RUN npm --prefix world-cup-command-center ci

COPY . .
RUN npm --prefix world-cup-command-center run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV PREDICTION_STORE_DRIVER=sqlite
ENV PREDICTION_STORE_PATH=/data/backend-store.sqlite

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

CMD ["node", "prediction-api/server.mjs"]
