# Private Key Usage Guide

## Overview

You can now use **either** a seed phrase OR a private key for `WALLET_MASTER_SEED`.

The WalletService automatically detects which format you're using.

## Supported Private Key Formats

### Format 1: Base58 (Most Common)
```env
WALLET_MASTER_SEED=5JvHV8z7bK9XFzPW4kqZ7bN3qV6xY2fQ8yH5mL4rG9wT3pX6dK8s
```
- **Source:** Phantom wallet export, `solana-keygen` command
- **Length:** 87-88 characters
- **Characters:** Base58 (1-9, A-Z, a-z, excluding 0, O, I, l)

### Format 2: Byte Array
```env
WALLET_MASTER_SEED=[123,45,67,89,12,34,56,78,90,...]
```
- **Source:** Solana CLI wallet files (e.g., `~/.config/solana/id.json`)
- **Format:** JSON array of 64 numbers
- **Each number:** 0-255

### Format 3: Hex String
```env
WALLET_MASTER_SEED=0123456789abcdef0123456789abcdef...
```
- **Length:** 128 characters (64 bytes * 2)
- **Characters:** Hexadecimal (0-9, a-f)

## How to Export Private Keys

### From Phantom Wallet

1. Open Phantom
2. Click **Settings** (gear icon)
3. **Security & Privacy**
4. **Export Private Key**
5. Confirm with password
6. Copy the Base58 string

**Example output:**
```
3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy2QXs4Z...
```

Paste directly into `.env`:
```env
WALLET_MASTER_SEED=3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy2QXs4Z...
```

### From Solflare Wallet

1. Open Solflare
2. **Settings**
3. **Security**
4. **Export Private Key**
5. Enter password
6. Copy the key

### From Solana CLI

If you have a wallet file (e.g., `~/.config/solana/id.json`):

**Option A: Use byte array directly**
```bash
cat ~/.config/solana/id.json
```

Copy the entire array to `.env`:
```env
WALLET_MASTER_SEED=[123,45,67,...]
```

**Option B: Convert to Base58**
```bash
# Install bs58 CLI tool
npm install -g bs58-cli

# Convert to Base58
cat ~/.config/solana/id.json | bs58 encode
```

Copy the Base58 string to `.env`.

### Generate New Private Key

**Using Solana CLI:**
```bash
solana-keygen new --no-bip39-passphrase -o my-wallet.json
cat my-wallet.json
```

**Using Node.js:**
```bash
node -e "const {Keypair} = require('@solana/web3.js'); const kp = Keypair.generate(); console.log('[' + kp.secretKey.toString() + ']')"
```

## Seed Phrase vs Private Key

### Seed Phrase (BIP39)
```env
WALLET_MASTER_SEED=word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12
```

**Pros:**
- ✅ Human-readable (12/24 words)
- ✅ Easier to backup on paper
- ✅ Standard BIP44 derivation
- ✅ Compatible with all wallets

**Cons:**
- ⚠️ Requires BIP39 wordlist validation
- ⚠️ Longer to type

### Private Key (Raw)
```env
WALLET_MASTER_SEED=5JvHV8z7bK9XFzPW4kqZ7bN3qV6xY2fQ8yH5mL4rG9wT3pX6dK8s
```

**Pros:**
- ✅ Direct from existing wallet
- ✅ Shorter (single line)
- ✅ Easy copy/paste from Phantom

**Cons:**
- ⚠️ Harder to backup (not words)
- ⚠️ Different derivation method
- ⚠️ Easy to make typos

## How Group Derivation Works

### With Seed Phrase (BIP44)
```
Seed Phrase
  → BIP39 seed
  → m/44'/501'/<hash(groupId)>'/0'
  → Group Wallet
```

### With Private Key (SHA256)
```
Private Key
  → SHA256(privateKey + groupId)
  → First 32 bytes as seed
  → Group Wallet
```

**Note:** Different derivation = different group wallets for same groupId!

## Example Configurations

### Development with Generated Key

```env
# Generate new key for testing
WALLET_MASTER_SEED=[123,45,67,89,12,34,56,78,90,123,45,67,89,12,34,56,78,90,123,45,67,89,12,34,56,78,90,123,45,67,89,12,34,56,78,90,123,45,67,89,12,34,56,78,90,123,45,67,89,12,34,56,78,90,123,45,67,89,12,34,56,78,90,123,45]
SOLANA_RPC_URL=https://api.devnet.solana.com
```

### Using Phantom Wallet on Devnet

```env
# Export your Phantom private key
WALLET_MASTER_SEED=3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy2QXs4ZABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr
SOLANA_RPC_URL=https://api.devnet.solana.com
```

### Production with Seed Phrase

```env
# Use seed phrase for easier backup
WALLET_MASTER_SEED=abandon ability able about above absent absorb abstract absurd abuse access accident
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

## Security Considerations

### Development
- ✅ Use test keys only
- ✅ Separate keys per environment
- ✅ Keep in .env (gitignored)

### Production
⚠️ **CRITICAL:**

1. **Never commit private keys**
   - Not in code
   - Not in git history
   - Not in documentation

2. **Secure storage**
   - Use secrets manager (AWS Secrets Manager, Vault)
   - Environment variables only
   - Encrypted backups

3. **Access control**
   - Limit who can see .env
   - Use different keys per environment
   - Monitor access logs

4. **Backup strategy**
   - **For seed phrase:** Write on paper, store in safe
   - **For private key:** Encrypted backup in multiple locations
   - Test recovery process

## Troubleshooting

### "Invalid private key format"

**Check your format:**
```bash
# Test if it's valid
node -e "
const input = 'YOUR_KEY_HERE';
const trimmed = input.trim();

// Check formats
console.log('Length:', trimmed.length);
console.log('Starts with [:', trimmed.startsWith('['));
console.log('Is Base58:', /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed));
console.log('Is Hex:', /^[0-9a-fA-F]{128}$/.test(trimmed));
"
```

### "Invalid seed phrase"

Make sure it's a valid BIP39 phrase:
```bash
node -e "
const bip39 = require('bip39');
console.log(bip39.validateMnemonic('your seed phrase here'));
"
```

### Wallet addresses different than expected

**Cause:** Derivation method differs between seed phrase and private key.

**Solution:** Stick with one method. If you switch, group wallets will be different.

## Migration: Seed Phrase ↔ Private Key

### ⚠️ WARNING

**Different derivation = different group wallets!**

If you change from seed phrase to private key (or vice versa), all group wallets will be different. You'll need to:

1. Note all existing group wallet addresses
2. Transfer funds to new addresses
3. Update group records

**Not recommended for production!**

## Testing

Test both formats work:

```bash
# Test with seed phrase
WALLET_MASTER_SEED="test seed phrase..." npm test

# Test with private key
WALLET_MASTER_SEED="5JvHV8..." npm test

# Run specific tests
npm test wallet-private-key.test.ts
```

## Recommendations

### For Development
✅ **Use private key** - Quick export from Phantom

### For Production
✅ **Use seed phrase** - Easier backup, standard format

### For Teams
✅ **Use seed phrase** - Can be written down, shared securely

### For Personal
Either works - choose what's easier for you!

## Next Steps

1. Choose your format (seed phrase or private key)
2. Export from your wallet or generate new
3. Add to `.env` file
4. Test derivation works
5. Backup securely
6. Start bot and initialize groups

## Support Commands

```bash
# Validate your key format
npm run validate-key

# Show derived addresses
npm run show-wallets

# Test encryption
npm test wallet
```

See `docs/generated/WALLET_SETUP.md` for complete wallet documentation.

