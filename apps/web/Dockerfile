FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
# NEXT_PUBLIC_* values are baked in at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile && pnpm --filter @glitch/web build && chown -R node:node /app/apps/web/.next
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@glitch/web", "start"]
