# Free Solana RPC Endpoints

This document lists tested free Solana RPC endpoints that can be used for read-only operations (background jobs, stats, etc.).

## Tested Working Endpoints

Based on testing, here are the **free, no-API-key-required** endpoints:

### 1. Official Solana Endpoints (Recommended for Devnet)
- **Mainnet**: `https://api.mainnet-beta.solana.com`
  - Latency: ~216ms
  - Rate limited but free
  - Official Solana Foundation endpoint

- **Devnet**: `https://api.devnet.solana.com`
  - Latency: ~986ms
  - Rate limited but free
  - Official Solana Foundation endpoint

### 2. PublicNode (Recommended)
- **URL**: `https://solana-rpc.publicnode.com`
- **Latency**: ~246ms
- **Status**: ✅ Working
- **Features**: 
  - No API key required
  - Fast response times
  - Good for production use

### 3. Pocket Network
- **URL**: `https://solana.api.pocket.network`
- **Latency**: ~1181ms
- **Status**: ✅ Working
- **Features**:
  - No API key required
  - Decentralized network
  - Slightly slower but reliable

## Failed Endpoints

These endpoints require API keys or are not accessible:

- ❌ `https://rpc.ankr.com/solana` - Requires API key
- ❌ `https://solana.public-rpc.com` - Not accessible

## Recommended Configuration

For **read-only operations** (background jobs, stats), use comma-separated URLs:

```bash
SOLANA_RPC_URL_READ_ONLY=https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com,https://api.devnet.solana.com
```

This configuration will:
- Rotate through endpoints automatically
- Fail over to next endpoint on rate limits
- Distribute load across multiple providers

## Testing

Run the test script to verify endpoints:

```bash
npx tsx scripts/test-rpc-endpoints.ts
```

## Rate Limits

All free endpoints have rate limits:
- **Official Solana**: ~40 requests per 10 seconds
- **PublicNode**: Varies, but generally more lenient
- **Pocket Network**: Varies based on network load

The RPC rotator automatically handles rate limits by rotating to the next endpoint.

## Production Considerations

For production use with high traffic:
1. Use the rotation feature with multiple endpoints
2. Consider paid RPC services for write operations (transactions)
3. Monitor rate limit errors and adjust accordingly
4. Use separate RPC for read-only vs write operations (already implemented)

## Free Tier Services (Require API Key)

These services offer free tiers but require API key registration:

- **Helius**: https://www.helius.dev/ (100k requests/day free)
- **QuickNode**: https://www.quicknode.com/ (Free tier available)
- **Triton**: https://triton.one/ (Free tier available)
- **Ankr**: https://www.ankr.com/ (Free tier available)

To use these, add your API key to the URL:
```
https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

