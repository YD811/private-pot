# Commission System Specification

## Overview
Collect 0.15% commission on deposits (during sweep) and sells, with fees sent to the operator wallet and tracked in the database.

## Requirements

### Commission Structure
| Event | Rate | Token | When |
|-------|------|-------|------|
| **Deposit** | 0.15% | SOL | During sweep to main pot |
| **Buy** | 0% | - | No commission |
| **Sell** | 0.15% | SOL | Deducted from output |

### Rationale
- **Deposit commission**: Taken during SOL sweep (user deposit address → group pot)
- **Sell commission**: Taken from SOL output (selling tokens → SOL)
- **Buy**: No commission to avoid complex token fee handling

## Implementation Changes

### 1. Deposit Sweep (`src/services/deposit-monitor.ts`)

**Current flow (line 458-465):**
```typescript
const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: userWallet.publicKey,
    toPubkey: groupPublicKey,
    lamports: amountToSend,
  }),
)
```

**New flow:**
```typescript
const feeAmount = amountToSend * 15n / 10000n  // 0.15%
const netAmount = amountToSend - feeAmount

const transaction = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: userWallet.publicKey,
    toPubkey: groupPublicKey,
    lamports: netAmount,
  }),
  SystemProgram.transfer({
    fromPubkey: userWallet.publicKey,
    toPubkey: operatorFeeWalletAddress,  // from config
    lamports: feeAmount,
  }),
)
```

### 2. Sell Execution (`src/bot/features/trade.ts`)

**For sell trades, after swap (around line 1006-1025):**

```typescript
// After swap completes, if it's a SELL
if (pendingTrade.tradeType === 'sell') {
  const outputAmount = BigInt(pendingTrade.quote.outAmount)
  const feeAmount = outputAmount * 15n / 10000n  // 0.15% of SOL output

  // Create fee transfer transaction
  const feeTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: groupWallet.publicKey,
      toPubkey: operatorFeeWalletAddress,
      lamports: feeAmount,
    }),
  )
  // Send fee transaction...
}
```

### 3. Database Schema

**Add `Commission` model:**
```prisma
model Commission {
  id                    String    @id @default(uuid())
  type                  String    // 'deposit' or 'sell'
  amountIn              BigInt    @map("amount_in")       // Total amount before fee
  feeAmount             BigInt    @map("fee_amount")      // Fee collected
  rateBps               Int       @map("rate_bps")        // 15 for 0.15%
  operatorWallet        String    @map("operator_wallet")
  transactionSignature  String?   @map("transaction_signature")  // Fee tx signature
  linkedSignature       String    @map("linked_signature")       // Deposit or sell tx
  createdAt             DateTime  @default(now()) @map("created_at")
}
```

### 4. Trade Receipt Display

**Deposit sweep notification (line ~350):**
```
✅ Deposit Confirmed!
@user deposited 1.0000 SOL
Commission (0.15%): 0.0015 SOL → Operator
Swept to pot: 0.9985 SOL
```

**Sell completion (line ~1144):**
```
✅ Trade Completed!
Sold: 1000 TOKEN
Received: 9.985 SOL
Commission (0.15%): 0.015 SOL → Operator
```

### Key Files to Modify
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `Commission` model |
| `src/services/deposit-monitor.ts` | Add fee transfer to sweep transaction |
| `src/bot/features/trade.ts` | Add fee transfer for sells |
| `src/config.ts` | Ensure `operatorFeeWalletAddress` is required |

### Edge Cases
| Scenario | Handling |
|----------|----------|
| Missing operator wallet | Skip commission, log warning |
| Tiny amounts | Commission rounded down (can be 0) |
| Failed fee transfer | Log error, don't block main transaction |
