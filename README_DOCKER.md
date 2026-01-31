# Docker Quick Start

## Setup

1. **Start PostgreSQL:**
```bash
docker compose up -d
```

2. **Copy environment file:**
```bash
cp env.example .env
```

3. **Edit `.env` and add:**
   - Your `BOT_TOKEN` from @BotFather
   - Generate `WALLET_ENCRYPTION_KEY`: 
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - For `WALLET_MASTER_SEED`, choose one:
     - **Option A:** Export private key from Phantom (Settings → Export Private Key)
     - **Option B:** Generate seed phrase: `npx bip39-cli generate`
     - **Option C:** Use your existing wallet seed phrase

4. **Initialize database:**
```bash
npm run db:generate
npm run db:push
```

5. **Start bot:**
```bash
npm run dev
```

## Docker Commands

```bash
# Start database
docker compose up -d

# Stop database
docker compose down

# View logs
docker compose logs -f postgres

# Connect to database
docker compose exec postgres psql -U potbot -d potbot
```

## Database Info

- **Host:** localhost
- **Port:** 5432
- **Database:** potbot
- **User:** potbot
- **Password:** potbot_dev_password
- **Connection String:** Already configured in `env.example`

The data is stored in a Docker named volume `potbot-postgres-data` (not in your project directory).

See `docs/generated/DOCKER_SETUP.md` for detailed documentation.

