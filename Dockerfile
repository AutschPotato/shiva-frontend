# ---------- Install ----------
FROM node:24-alpine AS install
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- Compile ----------
FROM node:24-alpine AS compile
WORKDIR /app
RUN corepack enable
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
