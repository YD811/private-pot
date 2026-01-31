#!/bin/sh

# Production startup script for PotBot
echo "🚀 Starting PotBot..."

# Generate Prisma client
echo "🗄️ Generating Prisma client..."
npm run db:generate

# Run database migrations
echo "🗄️ Running database migrations..."
npm run db:push

# Start the application
echo "🤖 Starting bot application..."
npm run start:prod
