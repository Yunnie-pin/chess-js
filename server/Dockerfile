# Konteks build adalah AKAR repo, bukan folder server/ — server memakai paket
# workspace @chess/shared, jadi keduanya harus ikut masuk.
#
# Tidak ada tahap kompilasi: Node 24 menjalankan TypeScript langsung lewat
# type stripping, dan kode ini memang ditulis agar kompatibel dengan itu.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Manifest dulu, sumber belakangan: selama dependensi tidak berubah, lapisan
# npm ci dipakai ulang dari cache.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
# Dibatasi ke workspace server: tanpa ini npm juga memasang dependensi produksi
# milik client (vue), yang tidak ada gunanya di image server — 17 paket menjadi 4.
RUN npm ci --omit=dev --ignore-scripts --workspace server --include-workspace-root \
    && npm cache clean --force

COPY shared/src ./shared/src
COPY server/src ./server/src

ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787

# Alpine tidak membawa curl; Node 24 sudah punya fetch global.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server/src/index.ts"]
