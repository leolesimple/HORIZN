FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT:-3003}/health', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{console.log(JSON.parse(d).status)}catch{}; process.exit(r.statusCode===200?0:1); }); }).on('error',()=>process.exit(1))"

EXPOSE 3003

CMD ["node", "js/index.js"]
