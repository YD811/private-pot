# Production Deployment Guide

This guide will help you deploy your **PotBot** (pooled trading fund Telegram bot) to a VPS with nginx-proxy, Let's Encrypt SSL, and PostgreSQL.

> **IMPORTANT**: This project follows strict Test-Driven Development (TDD) practices. Always read `agents.md` first to understand the development philosophy and ensure all tests pass before deployment.

## Prerequisites

- VPS with Docker and Docker Compose installed
- Domain name pointing to your VPS IP
- Telegram Bot Token from [@BotFather](https://t.me/botfather)
- **Read `agents.md`** to understand the project's TDD philosophy
- All tests must pass before deployment

## Quick Start

1. **Read the project documentation:**
   ```bash
   # Always start here - understand the TDD philosophy
   cat agents.md
   cat docs/specs.md  # Product specification
   ```

2. **Clone and setup environment:**
   ```bash
   git clone <your-repo>
   cd pot-bot
   cp env.prod.example .env.prod
   nano .env.prod  # Fill in your values
   ```

3. **Run tests (TDD requirement):**
   ```bash
   npm test  # Must pass before deployment
   ```

4. **Deploy:**
   ```bash
   ./deploy.sh  # Includes test validation
   ```

## Manual Setup

### 1. Create External Network

```bash
docker network create web
```

### 2. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp env.prod.example .env.prod
nano .env.prod
```

**Required Environment Variables:**

- `BOT_TOKEN`: Your Telegram bot token from @BotFather
- `BOT_WEBHOOK_SECRET`: A secure random string (min 12 characters)
- `POSTGRES_PASSWORD`: Secure password for PostgreSQL
- `WALLET_MASTER_SEED`: Your Solana wallet seed phrase or private key
- `WALLET_ENCRYPTION_KEY`: 64-character hex string for encryption
- `LETSENCRYPT_EMAIL`: Your email for Let's Encrypt certificates
- `SOLANA_RPC_URL`: Solana RPC endpoint (mainnet for production)

### 3. Deploy Services

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

## Architecture

**PotBot** is a Telegram bot that transforms group chats into trading funds with pooled Solana wallets. The deployment includes:

- **nginx-proxy**: Automatic reverse proxy with SSL termination
- **letsencrypt**: Automatic SSL certificate management  
- **postgres**: PostgreSQL database with persistent storage for:
  - Groups and wallet addresses
  - Member deposits and ownership percentages
  - Trade history and PnL tracking
  - Permissions and limits
  - Encrypted private keys
- **potbot**: Your Telegram bot application with:
  - grammY framework for Telegram interactions
  - Hono server for webhook handling
  - Pino logging for audit trails
  - Solana integration for trading
  - Jupiter swap integration

## Services

### nginx-proxy
- Handles SSL termination
- Routes traffic to your bot
- Automatically manages certificates

### Let's Encrypt
- Automatically obtains and renews SSL certificates
- Uses ACME protocol for certificate management

### PostgreSQL
- Persistent database storage
- Health checks for reliability
- Isolated internal network

### Pot Bot
- Runs in webhook mode for better performance
- Connects to PostgreSQL database
- Monitors Solana deposits
- Handles Telegram interactions

## Network Configuration

- **web**: External network for nginx-proxy and Let's Encrypt
- **internal**: Internal network for database communication

## SSL Configuration

The setup automatically:
- Obtains SSL certificates from Let's Encrypt
- Configures HTTPS redirect
- Handles certificate renewal

## Monitoring

### Check Service Status
```bash
docker-compose -f docker-compose.prod.yml ps
```

### View Logs
```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f potbot
```

### Health Checks
```bash
# Check if bot is responding
curl https://potbot.example.com/

# Check database connection
docker-compose -f docker-compose.prod.yml exec postgres pg_isready
```

## Maintenance

### Update Bot
```bash
git pull
docker-compose -f docker-compose.prod.yml up -d --build
```

### Backup Database
```bash
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U potbot potbot > backup.sql
```

### Restore Database
```bash
docker-compose -f docker-compose.prod.yml exec -T postgres psql -U potbot potbot < backup.sql
```

### Restart Services
```bash
# Restart all
docker-compose -f docker-compose.prod.yml restart

# Restart specific service
docker-compose -f docker-compose.prod.yml restart potbot
```

## Troubleshooting

### Bot Not Responding
1. Check if webhook is set: `curl https://potbot.example.com/webhook`
2. Check bot logs: `docker-compose -f docker-compose.prod.yml logs potbot`
3. Verify environment variables are correct

### SSL Issues
1. Check Let's Encrypt logs: `docker-compose -f docker-compose.prod.yml logs letsencrypt`
2. Verify domain DNS is pointing to your VPS
3. Ensure port 80 and 443 are open

### Database Issues
1. Check PostgreSQL logs: `docker-compose -f docker-compose.prod.yml logs postgres`
2. Verify database connection: `docker-compose -f docker-compose.prod.yml exec postgres pg_isready`

## Security Considerations

- Use strong passwords for PostgreSQL
- Keep your wallet seed phrase secure
- Regularly update Docker images
- Monitor logs for suspicious activity
- Use firewall to restrict access to necessary ports only

## Performance Optimization

- The bot runs in webhook mode for better performance
- PostgreSQL is configured with health checks
- nginx-proxy provides efficient SSL termination
- All services restart automatically on failure

## Support

For issues or questions:
1. Check the logs first
2. Verify your environment configuration
3. Ensure all prerequisites are met
4. Check the troubleshooting section above
