# Multi-stage build: pnpm install monorepo → build web + api → minimal runtime image.

# ─────────────────────────────────────────────────────────────
# Stage 1: deps — install all deps using pnpm
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/schemas/package.json ./packages/schemas/

# Install all deps (frozen lockfile → reproducible)
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────
# Stage 2: builder — compile TypeScript + bundle Vite
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/schemas/node_modules ./packages/schemas/node_modules

# Copy source
COPY . .

# Build schemas first (dependency for both api + web)
RUN pnpm --filter @order/schemas build

# Build API + web in parallel
RUN pnpm --filter @order/api build && pnpm --filter @order/web build

# ─────────────────────────────────────────────────────────────
# Stage 3: runtime — minimal image with prod deps + built artifacts
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# Copy manifests cho prod install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/schemas/package.json ./packages/schemas/

# Install ONLY production deps cho api (skip web - chỉ serve static)
RUN pnpm install --frozen-lockfile --prod --filter @order/api...

# Copy built schemas (api imports nó)
COPY --from=builder /app/packages/schemas/dist ./packages/schemas/dist

# Copy built api
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy built web (api serves nó qua useStaticAssets ở production)
COPY --from=builder /app/apps/web/dist ./apps/api/web-dist

# Working dir = apps/api để CWD nhất quán với dev (multer + main.ts dùng relative path)
WORKDIR /app/apps/api

# Tạo uploads/ mặc định (sẽ được mount qua volume nếu cần persist)
RUN mkdir -p uploads/menu

EXPOSE 3001

# Hardcoded — entrypoint của API
CMD ["node", "dist/main.js"]
