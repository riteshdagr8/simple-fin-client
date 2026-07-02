# Stage 1: Build
FROM node:20-bookworm AS builder

WORKDIR /app

# Install build deps for native modules (better-sqlite3, sharp)
RUN apt-get update -qq && apt-get install -y -qq \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install all dependencies (devDeps needed for vite build)
COPY package.json package-lock.json ./
RUN npm ci

# Build frontend
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-bookworm-slim

WORKDIR /app

# Runtime deps for sharp on slim
RUN apt-get update -qq && apt-get install -y -qq \
    libvips-dev \
  && rm -rf /var/lib/apt/lists/*

# Copy production node_modules only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built assets and server code
COPY --from=builder /app/dist ./dist
COPY server/ ./server/
COPY .env.example ./.env.example

# Receipt storage
RUN mkdir -p data/receipts

EXPOSE 4200

ENV NODE_ENV=production
ENV PORT=4200

VOLUME ["/app/data", "/app/.env"]

CMD ["node", "server/index.js"]
