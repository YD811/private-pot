# PotBot Setup Guide

## Prerequisites

- Node.js 20+
- PostgreSQL database
- Solana wallet seed phrase
- Telegram Bot Token

## Installation

1. **Clone and install dependencies**
```bash
npm install
```

2. **Set up environment variables**
```bash
cp .env.example .env
```

Edit `.env` and configure:

- `BOT_TOKEN`: Get from [@BotFather](https://t.me/BotFather)
- `DATABASE_URL`: Your PostgreSQL connection string
- `WALLET_MASTER_SEED`: BIP39 seed phrase for wallet derivation
- `WALLET_ENCRYPTION_KEY`: 64-character hex string for encrypting private keys
- `SOLANA_RPC_URL`: Solana RPC endpoint

**Generate encryption key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Generate seed phrase:**
```bash
npx bip39-cli generate
```

3. **Set up database**
```bash
npm run db:push
```

This will create all tables defined in `prisma/schema.prisma`.

4. **Generate Prisma client**
```bash
npm run db:generate
```

## Running the Bot

**Development mode** (with auto-reload):
```bash
npm run dev
```

**Production mode**:
```bash
npm start
```

## Testing

Run all tests:
```bash
npm test
```

Watch mode:
```bash
npm run test:watch
```

Coverage report:
```bash
npm run test:coverage
```

## Database Management

**View database in browser:**
```bash
npm run db:studio
```

**Create migration:**
```bash
npm run db:migrate
```

**Push schema changes (dev only):**
```bash
npm run db:push
```

## Bot Commands

Once running, add the bot to a Telegram group:

1. `/start` - Initialize group wallet (admin only)
2. `/deposit` - Get deposit instructions with unique code

## Architecture

- **Database**: PostgreSQL via Prisma ORM
- **Wallet**: Deterministic derivation from master seed
- **Encryption**: AES-256-CBC for private keys
- **Blockchain**: Solana for deposits and trading

See `docs/generated/ARCHITECTURE.md` for detailed architecture.

## Security Notes

⚠️ **NEVER commit or share:**
- `.env` file
- `WALLET_MASTER_SEED`
- `WALLET_ENCRYPTION_KEY`
- Private keys

🔒 **Production recommendations:**
- Use environment variables from secure vault
- Rotate encryption keys regularly
- Enable database encryption at rest
- Use SSL for database connections
- Monitor all wallet transactions
- Set up proper backup procedures

## Troubleshooting

**Database connection fails:**
- Check `DATABASE_URL` format
- Ensure PostgreSQL is running
- Verify database exists

**Bot doesn't respond:**
- Check `BOT_TOKEN` is valid
- Verify bot is added to group
- Check logs for errors

**Wallet generation fails:**
- Verify `WALLET_MASTER_SEED` is valid BIP39 phrase
- Check `WALLET_ENCRYPTION_KEY` is 64-char hex

## Next Steps

After setup:
1. Test deposit flow in a private group
2. Configure admin permissions
3. Set up transaction monitoring
4. Implement trading features
5. Add portfolio tracking


