FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @glitch/db generate \
 && pnpm turbo run build --filter=@glitch/worker...
USER node
# The API container applies migrations; the worker only connects.
CMD ["node", "apps/worker/dist/index.js"]
