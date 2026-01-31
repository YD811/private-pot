# Wallet Setup Guide

## Understanding the Wallet System

PotBot uses **deterministic wallet derivation**:

```
Your Master Seed (12/24 words)
    └─> Group 1 Wallet
    └─> Group 2 Wallet
    └─> Group 3 Wallet
    └─> ... (infinite wallets)
```

**One seed → infinite group wallets**

## Option 1: Use Existing Wallet (Recommended for Testing)

If you already have a Solana wallet (Phantom, Solflare, etc.), you can use its seed phrase:

### 1. Export Your Seed Phrase

**Phantom:**
- Settings → Security & Privacy → Reveal Secret Recovery Phrase
- Copy your 12/24 word phrase

**Solflare:**
- Settings → Security → Show Recovery Phrase
- Copy your phrase

### 2. Add to .env

```env
WALLET_MASTER_SEED=word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12
```

### 3. Fund on Devnet

```bash
# Get the derived wallet address (run after starting bot)
# Or use Solana CLI:
solana-keygen pubkey <path-to-derived-key>

# Request devnet SOL
solana airdrop 2 <wallet-address> --url devnet
```

## Option 2: Generate New Seed (Fresh Start)

### 1. Generate Seed Phrase

```bash
npx bip39-cli generate
```

Or use Node.js:
```bash
node -e "const bip39 = require('bip39'); console.log(bip39.generateMnemonic())"
```

### 2. Add to .env

```env
WALLET_MASTER_SEED=newly generated twelve word seed phrase from previous step here
```

### 3. Fund Derived Wallets

Each group will get a unique wallet address. Fund them as needed on devnet.

## Network Selection

### Development (Devnet)
```env
SOLANA_RPC_URL=https://api.devnet.solana.com
```

**Pros:**
- Free test SOL via airdrop
- No real funds at risk
- Fast iteration

**Get Devnet SOL:**
```bash
# Via CLI
solana airdrop 2 <wallet-address> --url devnet

# Via Faucet
# Visit: https://faucet.solana.com/
```

### Production (Mainnet)
```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

**Requirements:**
- Real SOL for testing
- Proper security measures
- Backup strategy
- Insurance/guarantees

### Custom RPC (Better Performance)
```env
# Alchemy
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# QuickNode
SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/

# Helius
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
```

## Security Best Practices

### Development
✅ Use devnet
✅ Use test seed phrase
✅ Keep seed in .env (gitignored)
✅ Never commit .env

### Production
⚠️ **Critical Security:**

1. **Never expose seed phrase**
   - Don't commit to git
   - Don't share in Discord/Telegram
   - Don't paste in logs
   - Don't screenshot

2. **Secure storage**
   - Use environment variables
   - Use secrets manager (AWS Secrets, Vault)
   - Consider HSM for large amounts
   - Multiple backups in secure locations

3. **Access control**
   - Limit who can access .env
   - Use different seeds per environment
   - Rotate regularly
   - Monitor wallet activity

4. **Backup strategy**
   ```bash
   # Write seed phrase on paper
   # Store in multiple secure locations:
   # - Safety deposit box
   # - Fireproof safe
   # - Trusted person
   # 
   # NEVER store digitally except encrypted
   ```

## How Wallet Derivation Works

### Path Structure
```
m/44'/501'/<hash(groupId)>'/0'
```

- `44'` = BIP44 standard
- `501'` = Solana coin type
- `<hash>` = Deterministic from group ID
- `0'` = First account

### Example
```typescript
// Group: -1001234567890
// Hash: SHA256(-1001234567890) → 0x1a2b3c4d
// Index: 439041101
// Path: m/44'/501'/439041101'/0'
// Wallet: Derived keypair (same every time)
```

### Benefits
- ✅ Deterministic (same group → same wallet)
- ✅ No need to store private keys (can regenerate)
- ✅ Infinite wallets from one seed
- ✅ Standard BIP44 derivation

## Wallet Management Commands

### Get Wallet Address (via Solana CLI)

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Derive wallet (after bot creates group)
# The bot will show you the address when you run /start
```

### Check Balance

```bash
solana balance <address> --url devnet
```

### Transfer SOL

```bash
solana transfer <recipient> <amount> --url devnet
```

### Airdrop (Devnet Only)

```bash
solana airdrop 2 <address> --url devnet
```

## Testing Deposit Flow on Devnet

### 1. Start Bot on Devnet

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
```

### 2. Initialize Group

In Telegram:
```
/start
```

Bot responds with wallet address like:
```
Group Wallet: 8xXy...zZ9
```

### 3. Fund Your Test Wallet

```bash
# Airdrop to YOUR wallet (that will send deposits)
solana airdrop 2 YOUR_WALLET_ADDRESS --url devnet
```

### 4. Get Deposit Code

```
/deposit
```

Bot gives you code like: `ABC12345`

### 5. Send Test Deposit

Use Phantom/Solflare on Devnet or CLI:

```bash
solana transfer \
  <group-wallet-address> \
  0.1 \
  --with-memo "ABC12345" \
  --url devnet
```

### 6. Verify

Bot should detect within 10 seconds and confirm deposit.

## Troubleshooting

### "Invalid seed phrase"

- Check word count (12 or 24 words)
- Verify BIP39 wordlist
- No extra spaces
- All lowercase

### "Cannot derive wallet"

```bash
# Test seed phrase validity
node -e "const bip39 = require('bip39'); console.log(bip39.validateMnemonic('your seed phrase here'))"
```

### "Connection refused" (RPC)

- Check SOLANA_RPC_URL is correct
- Try different RPC endpoint
- Verify network connectivity

### "Insufficient funds"

On devnet:
```bash
solana airdrop 2 <address> --url devnet
```

On mainnet:
- Transfer real SOL
- Ensure enough for rent + transactions

## Recovery

### Lost Seed Phrase?
❌ **Cannot recover** - funds are permanently lost

### Have Seed Phrase?
✅ Can regenerate all group wallets
✅ Can restore full system
✅ Can access all funds

### Backup Checklist
- [ ] Seed phrase written on paper
- [ ] Stored in 3+ secure locations
- [ ] Never stored digitally (except encrypted)
- [ ] Verified can restore wallet
- [ ] Trusted person knows location
- [ ] Regular verification schedule

## Advanced: Multiple Seeds

For production, consider:

### Per-Environment Seeds
```env
# Development
WALLET_MASTER_SEED=dev_seed_phrase_here

# Staging  
WALLET_MASTER_SEED=staging_seed_phrase_here

# Production
WALLET_MASTER_SEED=prod_seed_phrase_here
```

### Per-Group Seeds (Future Enhancement)
Currently one seed → all groups.
Could extend to: one seed per group for better isolation.

## Next Steps

1. ✅ Add seed phrase to .env
2. ✅ Set SOLANA_RPC_URL to devnet
3. ✅ Start bot and create group
4. ✅ Get group wallet address
5. ✅ Fund with devnet SOL
6. ✅ Test deposit flow
7. ✅ Verify monitoring works
8. Switch to mainnet for production

