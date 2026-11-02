FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server server
COPY shared shared
COPY public public
ENV NODE_ENV=production DATA_DIR=/data PORT=8090
EXPOSE 8090
CMD ["node", "server/index.js"]
