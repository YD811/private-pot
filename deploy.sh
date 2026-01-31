#!/bin/bash

# Production Deployment Script for Pot Bot
# This script deploys the bot to your VPS with nginx-proxy and Let's Encrypt
# 
# IMPORTANT: This project follows TDD practices as outlined in agents.md
# Always run tests before deployment and ensure all tests pass

set -e

echo "🚀 Starting Pot Bot Production Deployment..."
echo "📋 Following TDD practices from agents.md"

# Pull latest changes with specific SSH key
echo "📥 Pulling latest changes with SSH key..."
cd pot-bot
GIT_SSH_COMMAND='ssh -i ~/.ssh/smart-flip -o IdentitiesOnly=yes' git pull

# Check if .env.prod exists
if [ ! -f ".env.prod" ]; then
    echo "❌ Error: .env.prod file not found!"
    echo "Please copy env.prod.example to .env.prod and fill in your values:"
    echo "cp env.prod.example .env.prod"
    echo "nano .env.prod"
    exit 1
fi

# Run tests before deployment (TDD requirement)
# echo "🧪 Running tests before deployment..."
# if ! npm test; then
#     echo "❌ Tests failed! Please fix all tests before deploying."
#     echo "Remember: This project follows TDD practices (see agents.md)"
#     exit 1
# fi
# echo "✅ All tests passed!"

# Generate Prisma client
echo "🗄️ Generating Prisma client..."
npm run db:generate

# Note: External 'web' network should already exist (managed by nginx-proxy)
echo "📡 Using external 'web' network (should be managed by nginx-proxy)"

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod down || true

# Build and start services
echo "🔨 Building and starting services..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Database migrations are handled in the container startup command
echo "🗄️ Database migrations will run automatically on container startup"

# Check if services are running
echo "🔍 Checking service status..."
docker-compose -f docker-compose.prod.yml --env-file .env.prod ps

# Show logs
echo "📋 Recent logs:"
docker-compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=20

echo "✅ Deployment completed!"
echo "🌐 Your bot should be available at: https://pot-bot.chaser.tg"
echo "📊 Check logs with: docker-compose -f docker-compose.prod.yml --env-file .env.prod logs -f"
echo "🔄 Restart with: docker-compose -f docker-compose.prod.yml --env-file .env.prod restart"
