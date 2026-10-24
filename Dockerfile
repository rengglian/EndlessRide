# Stage 1: Build Three.js + TypeScript WebGL application
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first for optimal Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy configuration, source files, and static assets
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY public/ ./public/

# Compile production bundle into /app/dist
RUN npm run build

# Stage 2: Minimal Python 3.11 runtime (multi-arch for ARM64 Raspberry Pi and AMD64)
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies: pin websockets 11-12 for reliable process_request HTTP API
RUN pip install --no-cache-dir "websockets>=11.0,<13.0" smbus2

# Copy compiled frontend bundle from builder stage
COPY --from=builder /app/dist ./dist

# Copy Python Game & Sensor Hub server
COPY scripts/sensor_bridge.py ./scripts/sensor_bridge.py

# Create persistent storage directory for leaderboard and room state
RUN mkdir -p /app/data
ENV LEADERBOARD_FILE=/app/data/leaderboard.json

# Expose port 8080 for both HTTP/WebSocket (TCP) and AtomS3 binary packets (UDP)
EXPOSE 8080/tcp
EXPOSE 8080/udp

CMD ["python3", "-u", "scripts/sensor_bridge.py", "--port", "8080"]
