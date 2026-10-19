# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -f /tmp/build-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.pem; fi; npm install -g npm@11.9.0 && npm ci --fetch-retries=1 --fetch-timeout=20000
COPY . .
RUN npm run build:full

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -f /tmp/build-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.pem; fi; \
    npm install -g npm@11.9.0 && npm ci --fetch-retries=1 --fetch-timeout=20000 --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
USER node
EXPOSE 3000
CMD ["node", "build/server.cjs"]
