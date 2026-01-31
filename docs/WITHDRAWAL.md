# Withdrawal Feature

## Overview

The withdrawal feature allows users to withdraw their deposited funds from the group pot wallet back to their personal Solana wallet.

## Command Usage

### Basic Syntax
```
/withdraw <amount> <address>
```

### Parameters
- **amount**: Amount in SOL to withdraw, or use `all` to withdraw your entire balance
- **address**: Your Solana wallet address where you want to receive the funds

### Examples
```
/withdraw 0.5 YourSolanaAddressHere123456789
/withdraw all YourSolanaAddressHere123456789
```

## Features

- ✅ Withdraw specific amounts or entire balance
- ✅ Validates Solana addresses
- ✅ Checks user balance before processing
- ✅ Deducts transaction fees automatically
- ✅ Records all withdrawals in database
- ✅ Updates user and group balances
- ✅ Provides transaction confirmation with Solana Explorer link

## Validation Rules

1. **Minimum Withdrawal**: 0.001 SOL
2. **Group Requirement**: Only works in group chats (not private messages)
3. **Balance Check**: User must have sufficient deposits
4. **Group Initialization**: Group must be initialized with `/start` command
5. **Address Validation**: Must provide a valid Solana wallet address

## Transaction Flow

1. User sends withdrawal command with amount and address
2. Bot validates all parameters (chat type, amount, address, balance)
3. Bot shows processing message
4. Bot creates and signs transaction from group wallet
5. Transaction is sent to Solana network
6. Bot waits for confirmation
7. Database is updated:
   - Member's deposit balance reduced
   - Group's total deposits reduced
   - Withdrawal record created
8. Success message with transaction link is shown

## Database Schema

```prisma
model Withdrawal {
  id                    String    @id @default(uuid())
  groupId               String
  memberId              String
  amount                BigInt
  recipientAddress      String
  transactionSignature  String    @unique
  executedAt            DateTime
  createdAt             DateTime  @default(now())
  
  group                 Group     @relation(...)
  member                Member    @relation(...)
}
```

## Error Messages

| Situation | Message |
|-----------|---------|
| Private chat | "The /withdraw command is only available in group chats." |
| Invalid arguments | Shows help message with usage instructions |
| Invalid address | "❌ Invalid Solana address. Please provide a valid Solana wallet address." |
| Group not initialized | "This group has not been initialized yet. An admin needs to send /start first." |
| No deposits | "You haven't made any deposits yet. There's nothing to withdraw." |
| Zero balance | "Your balance is zero. There's nothing to withdraw." |
| Below minimum | "❌ Minimum withdrawal is 0.001 SOL. You tried to withdraw X SOL." |
| Insufficient balance | "❌ Insufficient balance. You have X SOL but tried to withdraw Y SOL." |
| Insufficient group funds | Shows message explaining group wallet doesn't have enough balance |
| Transaction error | Shows error message with details |

## Success Message Format

```
✅ Withdrawal Successful!

Amount: X.XXXX SOL
Recipient: <wallet-address>
New Balance: X.XXXX SOL

Transaction:
<explorer-link>

Your funds have been sent to your wallet!
```

## Security Considerations

1. **Private Key Security**: Group wallet private key is encrypted in database
2. **Transaction Signing**: All transactions signed by bot using encrypted keys
3. **Balance Tracking**: User balances tracked in database, not on-chain
4. **Validation**: Multiple validation steps before transaction execution
5. **Audit Trail**: All withdrawals recorded with transaction signatures

## Testing

To test the withdrawal feature on devnet:

1. Initialize a group with `/start`
2. Deposit funds using `/deposit`
3. Check balance with `/balance`
4. Withdraw funds: `/withdraw 0.1 YourDevnetWalletAddress`
5. Verify transaction on Solana Explorer (devnet)

## Technical Implementation

### Files
- **Feature**: `src/bot/features/withdraw.ts`
- **Schema**: `prisma/schema.prisma` (Withdrawal model)
- **Tests**: `tests/bot/features/withdraw.test.ts`
- **Locales**: `locales/en.ftl` (command description)

### Dependencies
- `@solana/web3.js`: For Solana blockchain interactions
- `grammy`: Telegram bot framework
- `@prisma/client`: Database operations

### Key Functions
- `formatSOL()`: Converts lamports to SOL with formatting
- `parseSOLAmount()`: Converts SOL input string to lamports
- `isValidSolanaAddress()`: Validates Solana wallet addresses
- `withdrawFeature()`: Main command handler

## Integration

The withdrawal feature is automatically integrated into the bot in `src/bot/index.ts`:

```typescript
protectedBot.use(withdrawFeature(prisma, walletService, config.solanaRpcUrl))
```

## Troubleshooting

### "Group wallet has insufficient balance"
- The group pot doesn't have enough SOL to process the withdrawal
- Check the group wallet balance on Solana Explorer
- This can happen if funds were swept or used for other purposes

### "Transaction failed"
- Network issues or RPC errors
- Try again in a few moments
- Check if the Solana network is experiencing issues

### "Cannot read properties of undefined"
- Bot might not be properly initialized
- Restart the bot
- Check database connection

## Future Enhancements

Potential improvements for future versions:

1. Withdrawal limits (daily/per-transaction)
2. Multi-signature approvals for large withdrawals
3. Withdrawal fees
4. Withdrawal history command
5. Scheduled/recurring withdrawals
6. Withdrawal to multiple addresses
7. Auto-withdrawal when balance reaches threshold

