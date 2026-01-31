<h1 align="center">🤖 PotBot - Group Trading Fund</h1>

A Telegram bot that transforms group chats into trading funds with pooled Solana wallets.

## Features

- **Group Trading Fund** - Pool SOL deposits from group members into a shared trading wallet
- **Personal Deposit Addresses** - Each member gets a unique deposit address
- **Privacy Cash Integration** - Optional privacy-preserving deposits using split withdrawals and ZK proofs
- **Token Trading** - Buy and sell Solana tokens via Jupiter DEX
- **Portfolio Tracking** - Real-time portfolio value and PnL tracking
- **Ownership Tracking** - Automatic calculation of member ownership percentages
- **Trading Limits** - Configurable per-trade and daily limits
- **Withdrawal System** - Members can withdraw their share proportionally
- **Commission System** - Optional operator fee (0.15%) on trades and deposits

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Bot Framework:** [grammY](https://grammy.dev/)
- **Server:** Hono (for webhooks)
- **Database:** PostgreSQL + [Prisma ORM](https://www.prisma.io/)
- **Blockchain:** Solana web3.js
- **DEX Integration:** [Jupiter API](https://station.jup.ag/)
- **Privacy:** [Privacy Cash](https://privacycash.io/) for enhanced deposit privacy
- **Logger:** Pino
- **Testing:** Vitest

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot and get deposit address |
| `/deposit` | Get personal deposit address |
| `/buy <token> <amount>` | Buy tokens with SOL |
| `/sell <token> <amount>` | Sell tokens for SOL |
| `/balance` | Show group's SOL balance |
| `/portfolio` | Show all token holdings and PnL |
| `/history` | Show recent trades |
| `/members` | Show group members and ownership |
| `/limits` | Show trading limits |
| `/withdraw` | Withdraw funds (admin) |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/add_trader` | Grant trading permissions |
| `/remove_trader` | Revoke trading permissions |
| `/set_limit` | Set per-trade or daily limits |
| `/pause` | Pause trading |
| `/unpause` | Resume trading |
| `/admin_trading` | Execute trades as admin |

## Privacy Cash Integration

When enabled, deposits are routed through Privacy Cash for enhanced privacy:

1. **Deposit Detection** - Bot monitors personal deposit addresses
2. **Privacy Pool** - Funds are deposited into Privacy Cash pool
3. **Split Withdrawals** - Multiple withdrawals to temporary wallets
4. **Transfer to Pot** - Final sweep to group wallet

This breaks the on-chain link between the depositor and the group pot.

### Configuration

Set these environment variables to enable Privacy Cash:

```bash
PRIVACY_CASH_ENABLED=true
```

**Note:** Privacy Cash has a minimum deposit of 0.01 SOL and charges 0.35% + 0.006 SOL per withdrawal.

## Quick Start

1. **Clone and Install**

```bash
git clone https://github.com/smart-flip/pot-bot.git
cd pot-bot
npm install
```

2. **Configure Environment**

```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Setup Database**

```bash
npm run db:generate
npm run db:push
```

4. **Run the Bot**

```bash
# Development
npm run dev

# Production
npm run start:force
```

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `BOT_TOKEN` | String | Telegram Bot API token from [@BotFather](https://t.me/BotFather) |
| `BOT_MODE` | String | `polling` or `webhook` |
| `DATABASE_URL` | String | PostgreSQL connection string |
| `SOLANA_RPC_URL` | String | Solana RPC endpoint |
| `WALLET_ENCRYPTION_KEY` | String | 32-byte hex key for wallet encryption |
| `PRIVACY_CASH_ENABLED` | Boolean | Enable Privacy Cash for deposits |
| `OPERATOR_FEE_WALLET_ADDRESS` | String | Wallet for commission fees |
| `LOG_LEVEL` | String | `info`, `debug`, `warn`, `error` |

See `.env.example` for a complete list.

## Development

### Commands

```bash
npm run dev          # Start in development mode (watch)
npm run lint         # Run linter
npm run format       # Format code
npm run typecheck    # Type checking
npm test             # Run tests
npm run test:watch   # Tests in watch mode
npm run test:coverage # Coverage report
```

### Directory Structure

```
pot-bot/
├── docs/              # Documentation
│   ├── specs.md       # Product specification
│   └── generated/     # Auto-generated docs
├── locales/           # Translation files (Fluent)
├── prisma/            # Database schema
├── src/
│   ├── bot/           # Telegram bot code
│   │   ├── features/  # Bot commands and features
│   │   ├── handlers/  # Update handlers
│   │   ├── keyboards/ # Inline keyboards
│   │   └── middlewares/
│   ├── services/      # Business logic
│   │   ├── deposit-monitor.ts    # Deposit detection
│   │   ├── privacy-sweep-processor.ts # Privacy Cash processing
│   │   ├── jupiter.ts            # DEX integration
│   │   ├── wallet.ts             # Wallet management
│   │   └── ...
│   ├── config.ts      # Configuration
│   └── main.ts        # Entry point
└── tests/             # Test files
```

### Testing

This project follows **Test-Driven Development (TDD)**. Always write tests first.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## Deployment

### Docker

```bash
docker-compose up -d
```

See [README_DOCKER.md](README_DOCKER.md) for detailed Docker setup.

### Manual

```bash
npm install --only=prod
npm run db:generate
npm run start:force
```

## Documentation

- [Product Specification](docs/specs.md) - Full feature specification
- [Agent Guide](agents.md) - AI agent navigation guide
- [Withdrawal Flow](docs/WITHDRAWAL.md) - Withdrawal implementation details
- [Docker Setup](README_DOCKER.md) - Container deployment

## License

MIT
