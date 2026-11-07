FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      qemu-system-x86 qemu-utils seabios ipxe-qemu nodejs npm ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
ENV DATA_DIR=/data PORT=8099
EXPOSE 8099
CMD ["node", "server/index.js"]
