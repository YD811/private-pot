# Use Node.js 20 Alpine as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for native modules and bash (canvas needs pkg-config + cairo/pixman/pango libs)
RUN apk add --no-cache python3 make g++ bash pkgconf cairo-dev giflib-dev libpng-dev pixman-dev pango-dev libjpeg-turbo-dev

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for Prisma)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and run migrations
RUN npm run db:generate

# Build the application
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S potbot -u 1001

# Change ownership of the app directory
RUN chown -R potbot:nodejs /app
USER potbot

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application (overridden by docker-compose command)
# CMD ["npm", "start"]
