#!/bin/bash

# Local Test Script for PotBot
# This script tests the bot locally with Docker

set -e

echo "🧪 Starting PotBot Local Test..."

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ Error: .env.local file not found!"
    echo "Please create .env.local with test values:"
    echo "cp env.prod.example .env.local"
    echo "nano .env.local"
    echo ""
    echo "For local testing, you can use:"
    echo "- BOT_MODE=polling (instead of webhook)"
    echo "- SOLANA_RPC_URL=https://api.devnet.solana.com"
    echo "- DEBUG=true"
    exit 1
fi

# Run tests first (TDD requirement)
echo "🧪 Running tests before local deployment..."
if ! npm test; then
    echo "❌ Tests failed! Please fix all tests before testing locally."
    echo "Remember: This project follows TDD practices (see agents.md)"
    exit 1
fi
echo "✅ All tests passed!"

# Generate Prisma client
echo "🗄️ Generating Prisma client..."
npm run db:generate

# Stop existing containers
echo "🛑 Stopping existing local containers..."
docker-compose -f docker-compose.local.yml --env-file .env.local down || true

# Build and start services
echo "🔨 Building and starting local services..."
docker-compose -f docker-compose.local.yml --env-file .env.local up -d --build

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check if services are running
echo "🔍 Checking service status..."
docker-compose -f docker-compose.local.yml --env-file .env.local ps

# Show logs
echo "📋 Recent logs:"
docker-compose -f docker-compose.local.yml --env-file .env.local logs --tail=20

echo "✅ Local test deployment completed!"
echo "🌐 Bot should be running locally"
echo "📊 Check logs with: docker-compose -f docker-compose.local.yml --env-file .env.local logs -f"
echo "🔄 Restart with: docker-compose -f docker-compose.local.yml --env-file .env.local restart"
echo "🛑 Stop with: docker-compose -f docker-compose.local.yml --env-file .env.local down"
