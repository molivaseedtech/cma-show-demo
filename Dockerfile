FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    CMA_DATA_DIR=/data/content \
    CMA_UPLOAD_DIR=/data/uploads

COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY admin ./admin
COPY assets ./assets
COPY data ./data
COPY index.html manifest.webmanifest sw.js icon.svg icon-192.png icon-512.png ./

RUN mkdir -p /data/content /data/uploads && chown -R node:node /app /data
USER node

EXPOSE 4173
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
