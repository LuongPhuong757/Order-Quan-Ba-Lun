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
COPY apps/shop/package.json ./apps/shop/
COPY packages/schemas/package.json ./packages/schemas/
# @order/utils là workspace dep của @order/api — thiếu manifest này thì
# pnpm install --frozen-lockfile vỡ (lockfile có, cây file thì không).
COPY packages/utils/package.json ./packages/utils/

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
COPY --from=deps /app/apps/shop/node_modules ./apps/shop/node_modules
COPY --from=deps /app/packages/schemas/node_modules ./packages/schemas/node_modules
COPY --from=deps /app/packages/utils/node_modules ./packages/utils/node_modules

# Copy source
COPY . .

# Build packages nền trước (api + web + shop đều import)
RUN pnpm --filter @order/schemas build && pnpm --filter @order/utils build

# Build API + 2 frontend. M2.D-66 — shop build ra bundle riêng cho order.<domain>.
RUN pnpm --filter @order/api build \
 && pnpm --filter @order/web build \
 && pnpm --filter @order/shop build

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
COPY packages/utils/package.json ./packages/utils/

# Install ONLY production deps cho api (skip web/shop - chỉ serve static).
# `@order/api...` kéo theo workspace dep của nó (schemas + utils).
RUN pnpm install --frozen-lockfile --prod --filter @order/api...

# Copy built packages nền (api imports cả 2)
COPY --from=builder /app/packages/schemas/dist ./packages/schemas/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist

# Copy built api
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy 2 frontend build. main.ts chọn thư mục theo Host header (M2.D-66):
#   order.<domain> → shop-dist   |   apex → web-dist
COPY --from=builder /app/apps/web/dist ./apps/api/web-dist
COPY --from=builder /app/apps/shop/dist ./apps/api/shop-dist

# Working dir = apps/api để CWD nhất quán với dev (multer + main.ts dùng relative path)
WORKDIR /app/apps/api

# Tạo uploads/ mặc định (sẽ được mount qua volume nếu cần persist)
RUN mkdir -p uploads/menu

EXPOSE 3001

# Hardcoded — entrypoint của API
CMD ["node", "dist/main.js"]
