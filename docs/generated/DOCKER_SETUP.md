# Docker Setup Guide

## Quick Start with Docker

### 1. Start PostgreSQL

```bash
docker compose up -d
```

This starts PostgreSQL in the background with:
- **Container name:** `potbot-postgres`
- **Database:** `potbot`
- **User:** `potbot`
- **Password:** `potbot_dev_password`
- **Port:** `5432` (mapped to host)
- **Volume:** `potbot-postgres-data` (named volume, not mapped to directory)

### 2. Check Status

```bash
# View logs
docker compose logs -f postgres

# Check if healthy
docker compose ps
```

### 3. Configure Application

The `.env.example` already has the correct DATABASE_URL:

```env
DATABASE_URL=postgresql://potbot:potbot_dev_password@localhost:5432/potbot
```

Copy it:
```bash
cp .env.example .env
```

Then edit `.env` to add:
- Your `BOT_TOKEN`
- Your `WALLET_ENCRYPTION_KEY` (generate with command in .env.example)
- Your `WALLET_MASTER_SEED` (generate with command in .env.example)

### 4. Initialize Database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push
```

### 5. Start Bot

```bash
npm run dev
```

## Docker Commands

### Basic Operations

```bash
# Start database
docker compose up -d

# Stop database
docker compose down

# Stop and remove volumes (DELETES ALL DATA)
docker compose down -v

# View logs
docker compose logs -f postgres

# Restart database
docker compose restart postgres
```

### Database Management

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U potbot -d potbot

# Backup database
docker compose exec postgres pg_dump -U potbot potbot > backup.sql

# Restore database
docker compose exec -T postgres psql -U potbot potbot < backup.sql

# Access PostgreSQL shell
docker compose exec postgres bash
```

### Volume Management

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect potbot-postgres-data

# Remove volume (DELETES ALL DATA)
docker volume rm potbot-postgres-data
```

## Production Configuration

For production, update `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: potbot-postgres
    restart: always  # Change to 'always'
    environment:
      POSTGRES_USER: potbot
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # Use secure password from env
      POSTGRES_DB: potbot
    ports:
      - "127.0.0.1:5432:5432"  # Only expose to localhost
    volumes:
      - potbot-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U potbot -d potbot"]
      interval: 10s
      timeout: 5s
      retries: 5
```

Then set `POSTGRES_PASSWORD` in your environment.

## Troubleshooting

### Port Already in Use

If port 5432 is already used:

```yaml
ports:
  - "5433:5432"  # Map to different host port
```

Update DATABASE_URL:
```env
DATABASE_URL=postgresql://potbot:potbot_dev_password@localhost:5433/potbot
```

### Connection Refused

1. Check container is running:
   ```bash
   docker compose ps
   ```

2. Check logs:
   ```bash
   docker compose logs postgres
   ```

3. Verify health:
   ```bash
   docker compose exec postgres pg_isready -U potbot
   ```

### Database Not Found

```bash
# Recreate database
docker compose exec postgres createdb -U potbot potbot
```

### Reset Everything

```bash
# Stop and remove all data
docker compose down -v

# Start fresh
docker compose up -d

# Reinitialize schema
npm run db:push
```

## Data Persistence

The named volume `potbot-postgres-data` persists data between container restarts.

**Location:** Managed by Docker (not in project directory)

**To find physical location:**
```bash
docker volume inspect potbot-postgres-data
```

**Backup strategy:**
```bash
# Automated backups (add to crontab)
docker compose exec postgres pg_dump -U potbot potbot | gzip > backup-$(date +%Y%m%d).sql.gz
```

## Advanced: Full Stack with Bot

Add bot service to `docker-compose.yml`:

```yaml
services:
  postgres:
    # ... existing config ...

  bot:
    build: .
    container_name: potbot
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://potbot:potbot_dev_password@postgres:5432/potbot
      BOT_TOKEN: ${BOT_TOKEN}
      WALLET_ENCRYPTION_KEY: ${WALLET_ENCRYPTION_KEY}
      WALLET_MASTER_SEED: ${WALLET_MASTER_SEED}
      BOT_MODE: polling
    volumes:
      - ./logs:/app/logs
```

## Security Notes

⚠️ **Development Settings:**
- Default password is weak
- Database exposed to host
- Suitable for local development only

🔒 **Production Requirements:**
- Strong passwords in environment
- SSL/TLS connections
- Restrict network access
- Regular backups
- Monitor logs
- Update base image regularly

## Next Steps

After database is running:
1. ✅ Database running in Docker
2. Configure `.env` with secrets
3. Run `npm run db:generate`
4. Run `npm run db:push`
5. Start bot with `npm run dev`
6. Test deposit flow

