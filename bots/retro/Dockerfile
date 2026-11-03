FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server server
COPY public public
COPY private private
ENV NODE_ENV=production DATA_DIR=/data PORT=8092
EXPOSE 8092
CMD ["node", "server/index.js"]
