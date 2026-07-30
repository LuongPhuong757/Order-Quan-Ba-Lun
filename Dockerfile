# Multi-stage build: pnpm install monorepo → build web + api → minimal runtime image.

# ─────────────────────────────────────────────────────────────
# Stage 1: deps — install all deps using pnpm
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests. PHẢI có ĐỦ mọi workspace member khớp pnpm-workspace.yaml
# (apps/* + packages/*): thiếu 1 cái thì `pnpm install --frozen-lockfile` không
# khớp được importers trong pnpm-lock.yaml → ERR_PNPM_OUTDATED_LOCKFILE.
# apps/shop chưa deploy (chưa có service trong docker-compose.prod.yml) nhưng vẫn
# phải copy manifest vì nó có mặt trong lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/shop/package.json ./apps/shop/
COPY packages/schemas/package.json ./packages/schemas/
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
COPY --from=deps /app/packages/schemas/node_modules ./packages/schemas/node_modules
COPY --from=deps /app/packages/utils/node_modules ./packages/utils/node_modules

# Copy source
COPY . .

# Build packages nội bộ TRƯỚC: api + web import chúng qua "main"/"types" trỏ vào
# dist/, chưa build thì tsc của api không resolve được @order/utils.
RUN pnpm --filter @order/schemas build && pnpm --filter @order/utils build

# Build API + web in parallel
RUN pnpm --filter @order/api build && pnpm --filter @order/web build

# ─────────────────────────────────────────────────────────────
# Stage 3: runtime — minimal image with prod deps + built artifacts
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# Copy manifests cho prod install. Chỉ cần workspace member nằm trong cây phụ
# thuộc của api (@order/api... = api + deps của nó) — web/shop không cần vì
# --filter đã loại chúng khỏi việc install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/utils/package.json ./packages/utils/

# Install ONLY production deps cho api (skip web - chỉ serve static)
RUN pnpm install --frozen-lockfile --prod --filter @order/api...

# Copy built packages nội bộ (api import lúc CHẠY, không chỉ lúc build)
COPY --from=builder /app/packages/schemas/dist ./packages/schemas/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist

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
