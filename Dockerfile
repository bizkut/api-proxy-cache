FROM node:16-alpine AS base

WORKDIR /app

COPY package*.json ./

RUN NODE_ENV=production npm ci

COPY index.js *.md ./
COPY src ./src

RUN chown -R 1000:1000 /app


FROM node:16-alpine

ENV PORT=8080 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE ${PORT}

WORKDIR /app

COPY --from=base --chown=node:node /app /app

USER node

CMD ["index.js"]
