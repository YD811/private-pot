import type { Logger } from '#root/logger.js'
import type { RPCRateLimiter } from './rpc-rate-limiter.js'
import { PublicKey } from '@solana/web3.js'
import { RPCRotator } from './rpc-rotator.js'

export interface TokenBalance {
  mint: string
  amount: bigint
  decimals: number
}

export class TokenBalanceService {
  private readonly connection: ReturnType<RPCRotator['createConnection']>

  constructor(
    rpcUrls: string | string[],
    private readonly rateLimiter: RPCRateLimiter,
    private readonly logger: Logger,
  ) {
    // Create RPC rotator for read-only operations
    const rpcRotator = new RPCRotator(rpcUrls, rateLimiter, logger)
    this.connection = rpcRotator.createConnection('confirmed')
  }

  /**
   * Get token balance for a specific mint address
   */
  async getTokenBalance(walletAddress: string, mintAddress: string): Promise<TokenBalance> {
    return this.rateLimiter.executeWithRetry(async () => {
      const walletPubkey = new PublicKey(walletAddress)
      const mintPubkey = new PublicKey(mintAddress)

      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(walletPubkey, {
        mint: mintPubkey,
      })

      if (tokenAccounts.value.length === 0) {
        return {
          mint: mintAddress,
          amount: BigInt(0),
          decimals: 0,
        }
      }

      // Sum up all token accounts for this mint
      let totalAmount = BigInt(0)
      let decimals = 0

      for (const account of tokenAccounts.value) {
        const accountData = (account.account.data as any).parsed.info
        const tokenAmount = BigInt(accountData.tokenAmount.amount)
        totalAmount += tokenAmount
        decimals = accountData.tokenAmount.decimals
      }

      return {
        mint: mintAddress,
        amount: totalAmount,
        decimals,
      }
    }, 'getTokenBalance')
  }

  /**
   * Get all token balances for a wallet
   * Queries both SPL Token and Token-2022 programs
   */
  async getAllTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    return this.rateLimiter.executeWithRetry(async () => {
      const walletPubkey = new PublicKey(walletAddress)

      // Query both SPL Token and Token-2022 programs
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

      const [splTokenAccounts, token2022Accounts] = await Promise.all([
        this.connection.getParsedTokenAccountsByOwner(walletPubkey, {
          programId: TOKEN_PROGRAM_ID,
        }),
        this.connection.getParsedTokenAccountsByOwner(walletPubkey, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ])

      const balances: TokenBalance[] = []
      const allAccounts = [...splTokenAccounts.value, ...token2022Accounts.value]

      for (const account of allAccounts) {
        const accountData = (account.account.data as any).parsed.info
        const mint = accountData.mint
        const amount = BigInt(accountData.tokenAmount.amount)
        const decimals = accountData.tokenAmount.decimals

        // Skip zero balance accounts
        if (amount > 0) {
          balances.push({
            mint,
            amount,
            decimals,
          })
        }
      }

      return balances
    }, 'getAllTokenBalances')
  }
}
