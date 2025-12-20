FROM node:20-slim

# Install ffmpeg, python3, and curl for yt-dlp
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm install --only=dev && npm run build && npm prune --production

# Copy web dashboard
COPY web ./web

# Create directories
RUN mkdir -p cache

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/admin/status || exit 1

CMD ["node", "dist/index.js"]
