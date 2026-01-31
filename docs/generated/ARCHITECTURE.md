# PotBot Architecture

## Database Schema

### Groups
- `id` - UUID primary key
- `telegram_group_id` - Telegram chat ID (unique)
- `wallet_address` - Solana public key
- `encrypted_private_key` - AES encrypted private key
- `encryption_nonce` - For decryption
- `total_deposits` - Sum of all deposits (lamports)
- `is_paused` - Trading pause state
- `created_at`
- `updated_at`

### Members
- `id` - UUID primary key
- `group_id` - FK to groups
- `telegram_user_id` - Telegram user ID
- `telegram_username` - Username (nullable)
- `deposits` - Total deposited (lamports)
- `is_trader` - Trading permission
- `trade_limit` - Per-transaction limit (lamports)
- `daily_limit` - Daily volume limit (lamports)
- `created_at`
- `updated_at`
- Unique: (group_id, telegram_user_id)

### DepositCodes
- `id` - UUID primary key
- `group_id` - FK to groups
- `telegram_user_id` - User who requested
- `code` - Short unique code (8 chars)
- `used` - Boolean
- `expires_at` - Expiration timestamp
- `created_at`
- Index: (code, used)

### Deposits
- `id` - UUID primary key
- `group_id` - FK to groups
- `member_id` - FK to members
- `deposit_code_id` - FK to deposit_codes
- `transaction_signature` - Solana tx signature
- `amount` - Lamports deposited
- `detected_at` - When tx was detected
- `created_at`

### Trades
- `id` - UUID primary key
- `group_id` - FK to groups
- `trader_id` - FK to members
- `transaction_signature` - Solana tx signature
- `trade_type` - 'buy' | 'sell'
- `token_address` - Token being traded
- `amount_in` - Input amount
- `amount_out` - Output amount
- `token_in` - Input token address
- `token_out` - Output token address
- `executed_at`
- `created_at`

### Positions
- `id` - UUID primary key
- `group_id` - FK to groups
- `token_address` - Token address
- `balance` - Current balance
- `cost_basis` - Total cost in SOL
- `updated_at`
- Unique: (group_id, token_address)

## Wallet Management

### Seed-based Account Generation
```typescript
// Master seed stored securely (env variable)
const masterSeed = process.env.WALLET_MASTER_SEED

// Derive wallet per group
function deriveGroupWallet(groupId: string) {
  const seed = derivePath(`m/44'/501'/${groupId}'`, masterSeed)
  return Keypair.fromSeed(seed)
}
```

### Encryption Strategy
- Use AES-256-GCM for private key encryption
- Encryption key from env: `WALLET_ENCRYPTION_KEY`
- Store nonce with encrypted data
- Never log private keys

## Deposit Flow

1. User sends `/deposit` in group
2. Bot generates unique 8-char code (alphanumeric)
3. Bot responds with:
   - Group wallet address
   - User's deposit code
   - Instructions
4. User transfers SOL with code in memo
5. Background worker polls for transactions
6. On detection:
   - Parse memo for code
   - Validate code & expiration
   - Credit user in database
   - Mark code as used
   - Update total_deposits
   - Notify group

## Permission System

### Roles
- **Admin**: Telegram group admin (checked via bot API)
- **Trader**: Member with `is_trader = true`
- **Member**: Any user with deposits > 0

### Middleware
```typescript
const requireAdmin = async (ctx, next) => {
  const isAdmin = await ctx.chatAdmin()
  if (!isAdmin) return
  await next()
}

const requireTrader = async (ctx, next) => {
  const member = await getMember(groupId, userId)
  if (!member?.is_trader) return
  await next()
}
```

## Transaction Monitoring

### Polling Strategy
- Poll wallet every 5 seconds
- Check last N transactions
- Track processed signatures in memory
- Parse memo field for deposit codes
- Validate sender and amount

### Alternative: Websocket
- Subscribe to wallet address
- Real-time notifications
- More efficient for high-volume

## Trading Flow

1. Trader sends `/buy JUP 2`
2. Bot validates:
   - Trader permission
   - Trade limits
   - Group not paused
3. Fetch Jupiter quote
4. Show confirmation with inline keyboard
5. On "Execute":
   - Sign transaction with group wallet
   - Submit to Solana
   - Record in database
   - Update positions
6. Notify group with trade details

## Ownership Calculation

```typescript
function calculateOwnership(deposits: number, totalDeposits: number): number {
  if (totalDeposits === 0) return 0
  return (deposits / totalDeposits) * 100
}
```

## Tech Stack

- **Database**: PostgreSQL + Prisma ORM
- **Blockchain**: Solana (@solana/web3.js)
- **Swaps**: Jupiter SDK
- **Encryption**: Node crypto module
- **Bot**: grammY framework
- **Testing**: Vitest + Supertest

## Security Considerations

1. **Private Key Management**
   - Never expose private keys
   - Encrypt at rest
   - Secure key derivation
   - Regular rotation of encryption keys

2. **Transaction Validation**
   - Verify all transactions on-chain
   - Implement replay protection
   - Rate limiting on commands
   - Audit trail for all operations

3. **Access Control**
   - Verify Telegram admin status
   - Check permissions before trades
   - Implement emergency pause
   - Admin-only sensitive operations

4. **Database Security**
   - Parameterized queries (Prisma handles this)
   - Connection pooling
   - Backup strategy
   - Encryption at rest


