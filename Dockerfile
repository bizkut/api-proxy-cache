FROM node:16-alpine AS base

WORKDIR /app

COPY package*.json ./

RUN NODE_ENV=production npm ci

COPY index.js *.md ./
COPY src ./src

RUN chown -R 1000:1000 /app


FROM node:16-alpine

RUN addgroup -g 1000 appgroup && adduser -D -u 1000 -G appgroup appuser

ENV PORT=8080 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE ${PORT}

WORKDIR /app

COPY --from=base --chown=appuser:appgroup /app /app

USER appuser

CMD ["index.js"]
