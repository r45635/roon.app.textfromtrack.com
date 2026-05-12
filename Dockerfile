# ─────────────────────────────────────────────────────────────────────────────
# TextFromTrack Roon Companion — multi-stage Dockerfile
#
# Stage 1 (builder): build the React client (client/dist/)
# Stage 2 (runtime): lean production image — no Electron, no devDeps
#
# Build:  docker build -t roon-companion .
# Run:    docker run -p 3888:3888 -e TFT_TOKEN=<token> roon-companion
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Copy client manifests first — leverages Docker layer cache on dep changes
COPY client/package*.json client/
RUN cd client && npm ci

# Copy client source and build
COPY client/ client/
RUN cd client && npm run build


# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Install production backend deps only (skips electron, electron-builder, eslint)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ src/
# config.json (Roon pairing tokens) is gitignored — node-roon-api creates it on
# first run. Do not COPY it here; mount a volume for persistence instead.

# Copy built client from builder stage
COPY --from=builder /build/client/dist client/dist/

# Persistent storage — settings, job history, lrc-cache
# Mount a host directory or named volume here: -v ./data:/app/src/storage
VOLUME ["/app/src/storage"]

EXPOSE 3888

CMD ["node", "src/server.js"]
