# Konteks build adalah AKAR repo — client memakai paket workspace @chess/shared.

# --- Tahap 1: build bundel ---------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --ignore-scripts

COPY shared/src ./shared/src
COPY client/ ./client/

# Kosongkan untuk menyambung ke `/ws` pada origin yang sama (lihat nginx.conf).
# Isi hanya bila server catur berada di host yang berbeda dari kliennya.
ARG VITE_SERVER_URL=""
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build --workspace client

# --- Tahap 2: sajikan berkas statis ------------------------------------------
FROM nginx:alpine

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
