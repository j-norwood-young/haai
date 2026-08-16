FROM node:22-alpine AS base
RUN npm install -g pnpm@latest
WORKDIR /app

# Install dependencies
FROM base AS deps
# Native modules (isolated-vm, better-sqlite3) require a C++ toolchain on Alpine.
RUN apk add --no-cache python3 make g++ linux-headers
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json ./packages/core/
COPY packages/proxy/package.json ./packages/proxy/
COPY packages/hooks-sdk/package.json ./packages/hooks-sdk/
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY packages/cli/package.json ./packages/cli/
COPY packages/mcp/package.json ./packages/mcp/
COPY apps/web/package.json ./apps/web/
COPY docs/package.json ./docs/
RUN pnpm install --frozen-lockfile

# Build all packages
FROM deps AS builder
COPY . .
ENV CI=true
RUN pnpm install --frozen-lockfile && pnpm build

# Production image
FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/proxy ./packages/proxy
COPY --from=builder /app/packages/hooks-sdk ./packages/hooks-sdk
COPY --from=builder /app/packages/plugin-sdk ./packages/plugin-sdk
COPY --from=builder /app/packages/cli ./packages/cli
COPY --from=builder /app/packages/mcp ./packages/mcp
COPY --from=builder /app/apps/web/build ./apps/web/build
COPY --from=builder /app/docs/.vitepress/dist ./docs/.vitepress/dist

EXPOSE 4000
VOLUME ["/data"]
ENV HAAI_DATA_DIR=/data

CMD ["node", "packages/proxy/dist/index.js"]
