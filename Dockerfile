FROM node:16-alpine AS base

WORKDIR /app

COPY package*.json ./

RUN NODE_ENV=production npm ci

COPY index.js *.md ./
COPY src ./src

RUN chown -R 1000:1000 /app


FROM gcr.io/distroless/nodejs:16

ENV PORT=8080 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE ${PORT}

WORKDIR /app

COPY --from=base --chown=1000:1000 /app /app

USER 1000

CMD ["index.js"]
