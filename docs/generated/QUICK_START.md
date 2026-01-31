# Quick Start Guide

## Installation (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Generate secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > encryption_key.txt
npx bip39-cli generate > seed_phrase.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with:
# - BOT_TOKEN from @BotFather
# - DATABASE_URL from your PostgreSQL
# - WALLET_ENCRYPTION_KEY from encryption_key.txt
# - WALLET_MASTER_SEED from seed_phrase.txt

# 4. Setup database
npm run db:generate
npm run db:push

# 5. Run tests
npm test

# 6. Start bot
npm run dev
```

## Usage Flow

### 1. Initialize Group
```
Admin in group: /start
Bot: Creates wallet and shows address
```

### 2. Get Deposit Code
```
Member: /deposit
Bot: Shows wallet address and unique code
```

### 3. Make Deposit
```
User sends SOL to wallet address
Include code in memo field (e.g., "ABC12345")
```

### 4. Confirmation
```
Bot detects deposit within seconds
Credits user's account
Shows confirmation in group
```

## What's Next

After deposit flow is working:

1. **Wire services** - See `INTEGRATION_GUIDE.md`
2. **Add admin commands** - Grant trader permissions
3. **Implement trading** - Jupiter integration
4. **Add portfolio** - Track holdings and PnL

## File Structure

```
src/
├── services/           # Core business logic
│   ├── wallet.ts          # Wallet derivation & encryption
│   ├── deposit-code.ts    # Code generation
│   ├── group.ts           # Group management
│   └── transaction-monitor.ts  # Blockchain polling
├── bot/
│   └── features/       # Bot commands
│       ├── start.ts       # Initialize group
│       └── deposit.ts     # Get deposit code
└── db.ts              # Prisma client

tests/
└── services/          # All tests
    └── *.test.ts

docs/generated/        # All documentation
├── FEATURES.md           # Feature checklist
├── ARCHITECTURE.md       # System design
├── IMPLEMENTATION_SUMMARY.md  # What was built
├── INTEGRATION_GUIDE.md  # How to wire it up
└── SETUP.md             # Installation guide
```

## Key Concepts

### Deterministic Wallets
- 1 master seed → infinite group wallets
- Same groupId always generates same wallet
- Private keys encrypted in database

### Deposit Attribution
- User gets unique code
- Sends SOL with code in memo
- Bot detects and credits account
- Ownership = deposits / total

### Security Model
- Backend-managed wallets (not trustless)
- Users trust bot operator
- Suitable for known communities

## Commands Reference

### Bot Commands
- `/start` - Initialize group (admin only)
- `/deposit` - Get deposit code (all members)

### NPM Scripts
- `npm run dev` - Development with auto-reload
- `npm test` - Run all tests
- `npm run test:watch` - Watch mode
- `npm run test:coverage` - Coverage report
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Update database schema
- `npm run db:studio` - Database GUI

## Environment Variables

**Required:**
```env
BOT_TOKEN=               # From @BotFather
DATABASE_URL=            # PostgreSQL connection
WALLET_MASTER_SEED=      # BIP39 seed phrase
WALLET_ENCRYPTION_KEY=   # 64-char hex string
```

**Optional:**
```env
BOT_MODE=polling         # or 'webhook'
SOLANA_RPC_URL=          # Default: mainnet
LOG_LEVEL=info
DEBUG=true
```

## Troubleshooting

**"Cannot find module '@prisma/client'"**
```bash
npm run db:generate
```

**"Invalid config"**
- Check all required env vars are set
- Verify WALLET_ENCRYPTION_KEY is 64-char hex
- Ensure WALLET_MASTER_SEED is valid BIP39

**Tests failing**
```bash
npm install
npm run db:generate
npm test
```

**Database errors**
```bash
npm run db:push  # Sync schema
npm run db:studio  # Inspect data
```

## Architecture at a Glance

```
User deposits SOL with memo code
         ↓
TransactionMonitorService polls blockchain
         ↓
Validates code and amount
         ↓
Credits member account atomically
         ↓
Updates group total deposits
         ↓
Calculates new ownership %
         ↓
Notifies group chat
```

## Testing

All services have full test coverage:
```bash
npm test                 # All tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run test:ui          # Visual UI
```

## Documentation

- **FEATURES.md** - What's done, what's not
- **ARCHITECTURE.md** - How it works
- **IMPLEMENTATION_SUMMARY.md** - What was built
- **INTEGRATION_GUIDE.md** - How to connect pieces
- **SETUP.md** - Installation steps
- **QUICK_START.md** - This file

## Support

Check existing docs:
1. Read error message carefully
2. Check relevant doc in `docs/generated/`
3. Review test files for examples
4. Check config in `.env`

## Production Checklist

Before deploying:
- [ ] Tests passing
- [ ] Database backed up
- [ ] Secrets secured (vault/HSM)
- [ ] Monitoring configured
- [ ] Error alerts setup
- [ ] Backup seed phrase stored safely
- [ ] SSL for database
- [ ] Rate limiting configured

## Next Features

Priority order:
1. Integration (wire services)
2. Admin commands (trader management)
3. Balance/portfolio info
4. Trading (Jupiter)
5. PnL tracking
6. Withdrawals

See `FEATURES.md` for complete list.


