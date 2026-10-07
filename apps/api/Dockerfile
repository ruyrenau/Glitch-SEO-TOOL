FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @glitch/db generate \
 && pnpm turbo run build --filter=@glitch/api...
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
# Apply migrations to the SQLite volume, then start the API.
CMD ["sh", "-c", "cd packages/db && npx prisma migrate deploy && cd /app && node apps/api/dist/index.js"]
