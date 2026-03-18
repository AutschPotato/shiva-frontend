# ---------- Install ----------
FROM node:24-alpine AS install
WORKDIR /app
RUN corepack enable \
 && corepack prepare pnpm@9.0.0 --activate
ENV PNPM_FETCH_RETRIES=5 \
    PNPM_FETCH_RETRY_MINTIMEOUT=10000 \
    PNPM_FETCH_RETRY_MAXTIMEOUT=120000 \
    PNPM_FETCH_TIMEOUT=300000
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prefer-offline

# ---------- Compile ----------
FROM node:24-alpine AS compile
WORKDIR /app
RUN corepack enable \
 && corepack prepare pnpm@9.0.0 --activate
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---------- Serve ----------
FROM node:24-alpine AS serve
WORKDIR /app

ENV NODE_ENV=production

COPY --from=compile /app/.next/standalone ./
COPY --from=compile /app/.next/static ./.next/static
COPY --from=compile /app/public ./public

EXPOSE 3000

CMD ["sh", "-c", "HOSTNAME=0.0.0.0 PORT=3000 node server.js"]
