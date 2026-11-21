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
FROM node:22-alpine AS builder

WORKDIR /build

# Copy client manifests first — leverages Docker layer cache on dep changes
COPY client/package*.json client/
RUN cd client && npm ci

# Copy client source and build
COPY client/ client/
# Commit shown in Settings → About (the build context has no .git); the release workflow passes it.
ARG BUILD_COMMIT=""
RUN cd client && BUILD_COMMIT="$BUILD_COMMIT" npm run build


# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Install production backend deps only (skips electron, electron-builder, eslint)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ src/
# node-roon-api writes the Roon pairing (config.json) to its working directory. Link it into
# the data folder, or every new container has to be enabled in Roon again.
RUN ln -s /app/src/storage/config.json /app/config.json

# Copy built client from builder stage
COPY --from=builder /build/client/dist client/dist/

# Persistent storage — settings, job history, lrc-cache. Data only: a mount replaces
# this whole directory, so no code may live in it (see tests/utils/storageLayout.test.js).
# Mount a host directory or named volume here: -v ./data:/app/src/storage
VOLUME ["/app/src/storage"]

EXPOSE 3888

# "Up" is not "serving": the check asks the API itself (no LRCLIB call, loopback passes the
# access guard), so `docker ps` and a NAS UI show a backend that stopped answering.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3888}/api/debug/info" >/dev/null || exit 1

CMD ["node", "src/server.js"]
