import type { Logger } from '#root/logger.js'
import type { QuoteGetRequest, QuoteResponse } from '@jup-ag/api'
import type { IJupiterService } from './jupiter-interface.js'
import { Buffer } from 'node:buffer'
import { createJupiterApiClient } from '@jup-ag/api'
import {
  getAssociatedTokenAddress,
  getMint,
  getTokenMetadata,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'

// Metaplex Token Metadata Program ID
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

const LAMPORTS_PER_SOL = 1_000_000_000

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export interface SwapQuote {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  priceImpactPct: string
  routePlan: any[]
}

export interface TokenRiskInfo {
  isVerified: boolean
  isTradable: boolean
  hasFreezeAuthority: boolean | null
  mintAuthorityRevoked: boolean | null
  riskLevel: 'verified' | 'tradable' | 'unknown'
}

export class JupiterService implements IJupiterService {
  private readonly jupiterApi: ReturnType<typeof createJupiterApiClient>
  private readonly connection: Connection
  private tokenCache: Map<string, TokenInfo> = new Map()
  private verifiedTokensCache: Set<string> | null = null
  private verifiedTokensCacheTime: number = 0
  private readonly VERIFIED_CACHE_TTL = 60 * 60 * 1000 // 1 hour

  // Common Solana tokens
  public readonly COMMON_TOKENS: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  }

  constructor(
    rpcUrl: string,
    private readonly logger: Logger,
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed')
    this.jupiterApi = createJupiterApiClient()
  }

  /**
   * Get a quote for swapping tokens
   * @param inputMint Input token mint address
   * @param outputMint Output token mint address
   * @param amount Amount to swap
   * @param slippageBps Slippage in basis points (default 50 = 0.5%)
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50, // 0.5% default slippage
  ): Promise<QuoteResponse> {
    try {
      const quoteRequest: QuoteGetRequest = {
        inputMint,
        outputMint,
        amount,
        slippageBps,
        onlyDirectRoutes: false,
        // Use versioned transactions (default) to support larger routes via ALTs
        // Legacy transactions can fail with "decoded too large" error for complex routes
      }

      const quote = await this.jupiterApi.quoteGet(quoteRequest)

      if (!quote) {
        throw new Error('No quote received from Jupiter')
      }

      this.logger.debug({ quoteRequest, quote }, 'Jupiter quote received')

      return quote
    }
    catch (error) {
      this.logger.error({ error, inputMint, outputMint, amount }, 'Failed to get Jupiter quote')
      throw error
    }
  }

  /**
   * Execute a swap transaction
   * @param quote Quote response from getQuote
   * @param userPublicKey User's public key
   * @param feeAccount Token account address to receive platform fees (must match input or output mint)
   */
  async executeSwap(
    quote: QuoteResponse,
    userPublicKey: PublicKey,
    feeAccount?: string,
  ): Promise<string> {
    try {
      // Get serialized transaction from Jupiter
      const swapRequest: any = {
        userPublicKey: userPublicKey.toBase58(),
        quoteResponse: quote,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        // Use versioned transactions (default) to support larger routes via ALTs
        // Legacy transactions can fail with "decoded too large" error for complex routes
      }

      // Add fee account if provided
      if (feeAccount) {
        swapRequest.feeAccount = feeAccount
      }

      const swapResponse = await this.jupiterApi.swapPost({
        swapRequest,
      })

      if (!swapResponse.swapTransaction) {
        throw new Error('No swap transaction received from Jupiter')
      }

      this.logger.debug({ quote: quote.outAmount, feeAccount }, 'Jupiter swap transaction prepared')

      return swapResponse.swapTransaction
    }
    catch (error: any) {
      // Log more details about the error
      const errorDetails = {
        name: error?.name,
        message: error?.message,
        response: error?.response,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        data: error?.response?.data,
        feeAccount,
      }
      this.logger.error({ error: errorDetails, quote: quote.outAmount }, 'Failed to execute Jupiter swap')
      throw error
    }
  }

  /**
   * Get or derive the associated token account address for a mint and owner
   * This is used for fee accounts - the fee account must be for the input or output mint
   *
   * Note: For non-SOL tokens, Jupiter will automatically create the ATA if it doesn't exist
   * as part of the swap transaction. For SOL, the wallet address itself is used.
   */
  async getAssociatedTokenAccountAddress(
    mintAddress: string,
    ownerPublicKey: PublicKey,
  ): Promise<PublicKey> {
    // For SOL, return the wallet address itself (no ATA needed)
    if (mintAddress === this.COMMON_TOKENS.SOL) {
      return ownerPublicKey
    }

    // For SPL tokens, get the ATA address
    // Jupiter will create it if it doesn't exist during the swap
    const mint = new PublicKey(mintAddress)
    return getAssociatedTokenAddress(mint, ownerPublicKey)
  }

  /**
   * Check if a token account exists on-chain
   * Returns true if the account exists, false otherwise
   */
  async tokenAccountExists(accountAddress: PublicKey): Promise<boolean> {
    try {
      const accountInfo = await this.connection.getAccountInfo(accountAddress)
      return accountInfo !== null
    }
    catch {
      return false
    }
  }

  /**
   * Extract the actual platform fee amount from a completed swap transaction
   * This reads the fee from the blockchain by checking the fee account's balance change
   * @param txSignature Transaction signature
   * @param feeAccountAddress Fee account address that received the platform fee
   * @param mintAddress Mint address of the fee token (must match fee account mint)
   * @returns The actual fee amount collected, or null if unable to determine
   */
  async getPlatformFeeFromTransaction(
    txSignature: string,
    feeAccountAddress: string,
    mintAddress: string,
  ): Promise<bigint | null> {
    try {
      // Get the parsed transaction with retries (transaction might not be immediately indexed)
      let tx = null
      const maxRetries = 5
      const retryDelay = 1000 // 1 second

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          tx = await this.connection.getParsedTransaction(txSignature, {
            maxSupportedTransactionVersion: 0,
          })
          if (tx && tx.meta) {
            break
          }
        }
        catch {
          this.logger.debug({ txSignature, attempt: attempt + 1 }, 'Failed to get parsed transaction, retrying...')
        }

        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }

      if (!tx || !tx.meta) {
        this.logger.warn({ txSignature }, 'Transaction not found or has no metadata after retries')
        return null
      }

      // Find the fee account in the transaction's account keys
      const accountKeys = tx.transaction.message.accountKeys
      const feeAccountIndex = accountKeys.findIndex(
        (key: any) => {
          const pubkey = typeof key === 'string' ? key : key.pubkey?.toBase58()
          return pubkey === feeAccountAddress
        },
      )

      if (feeAccountIndex === -1) {
        this.logger.warn({ txSignature, feeAccountAddress }, 'Fee account not found in transaction')
        return null
      }

      // For token accounts, we need to check token balance changes
      // Check if this is a token account (not SOL)
      if (mintAddress === this.COMMON_TOKENS.SOL) {
        // For SOL, check SOL balance change
        const preBalance = tx.meta.preBalances[feeAccountIndex] ?? 0
        const postBalance = tx.meta.postBalances[feeAccountIndex] ?? 0
        const feeAmount = BigInt(postBalance - preBalance)
        return feeAmount > 0n ? feeAmount : null
      }

      // For SPL tokens, check token balance changes in pre/post token balances
      const preTokenBalances = tx.meta.preTokenBalances || []
      const postTokenBalances = tx.meta.postTokenBalances || []

      // Find pre and post balances for the fee account
      const preBalance = preTokenBalances.find(
        (balance: any) => {
          const accountIndex = typeof balance.accountIndex === 'number'
            ? balance.accountIndex
            : accountKeys.findIndex((key: any) => {
                const pubkey = typeof key === 'string' ? key : key.pubkey?.toBase58()
                return pubkey === feeAccountAddress
              })
          return accountIndex === feeAccountIndex
            && balance.mint === mintAddress
        },
      )

      const postBalance = postTokenBalances.find(
        (balance: any) => {
          const accountIndex = typeof balance.accountIndex === 'number'
            ? balance.accountIndex
            : accountKeys.findIndex((key: any) => {
                const pubkey = typeof key === 'string' ? key : key.pubkey?.toBase58()
                return pubkey === feeAccountAddress
              })
          return accountIndex === feeAccountIndex
            && balance.mint === mintAddress
        },
      )

      if (!preBalance || !postBalance) {
        // Fee account might not have existed before (was created during swap)
        // In this case, check only post balance - the entire amount is the fee
        if (postBalance) {
          const amount = BigInt(postBalance.uiTokenAmount.amount || '0')
          if (amount > 0n) {
            this.logger.debug(
              { txSignature, feeAccountAddress, amount },
              'Fee account was created during swap, entire post balance is fee',
            )
            return amount
          }
        }
        this.logger.warn(
          { txSignature, feeAccountAddress, mintAddress },
          'Could not find token balance changes for fee account - account may not have been created or fee was 0',
        )
        return null
      }

      const preAmount = BigInt(preBalance.uiTokenAmount.amount || '0')
      const postAmount = BigInt(postBalance.uiTokenAmount.amount || '0')
      const feeAmount = postAmount - preAmount

      return feeAmount > 0n ? feeAmount : null
    }
    catch (error) {
      this.logger.error({ error, txSignature, feeAccountAddress }, 'Failed to extract platform fee from transaction')
      return null
    }
  }

  /**
   * Sign and send a swap transaction
   */
  async sendSwapTransaction(
    swapTransactionBase64: string,
    wallet: any, // Keypair
  ): Promise<string> {
    try {
      // Deserialize the transaction
      const swapTransactionBuf = Buffer.from(swapTransactionBase64, 'base64')
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf)

      // Sign the transaction
      transaction.sign([wallet])

      // Send the transaction
      // Note: Skip preflight for Jupiter swaps because simulation fails with ALTs
      const rawTransaction = transaction.serialize()
      const latestBlockhash = await this.connection.getLatestBlockhash('confirmed')

      const txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      })

      this.logger.info({ txid }, 'Swap transaction sent')

      // Confirm the transaction using the new API
      // Use 'finalized' commitment and handle WebSocket errors gracefully
      try {
        await this.connection.confirmTransaction({
          signature: txid,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        }, 'finalized')
        this.logger.info({ txid }, 'Swap transaction confirmed')

        // Verify the transaction actually succeeded by checking its status
        // Retry a few times as transaction might not be immediately available
        let txStatus = null
        let parsedTx = null
        const maxRetries = 5
        const retryDelay = 1000 // 1 second

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            txStatus = await this.connection.getSignatureStatus(txid)
            if (txStatus?.value) {
              break
            }
          }
          catch {
            this.logger.debug({ txid, attempt: attempt + 1 }, 'Failed to get signature status, retrying...')
          }

          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
          }
        }

        // Check transaction status first
        if (txStatus?.value?.err) {
          const errorMessage = JSON.stringify(txStatus.value.err)
          this.logger.error({ txid, error: txStatus.value.err }, 'Transaction failed after confirmation')
          throw new Error(`Transaction failed: ${errorMessage}`)
        }

        // Also verify by parsing the transaction to check for instruction errors
        // Retry parsing as well
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            parsedTx = await this.connection.getParsedTransaction(txid, {
              maxSupportedTransactionVersion: 0,
            })
            if (parsedTx) {
              break
            }
          }
          catch {
            this.logger.debug({ txid, attempt: attempt + 1 }, 'Failed to get parsed transaction, retrying...')
          }

          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
          }
        }

        // Check parsed transaction for errors
        if (parsedTx?.meta?.err) {
          const errorMessage = JSON.stringify(parsedTx.meta.err)
          this.logger.error({ txid, error: parsedTx.meta.err }, 'Transaction has errors in metadata')
          throw new Error(`Transaction failed: ${errorMessage}`)
        }

        // If we have status but no parsed tx, check if status indicates success
        if (!parsedTx && txStatus?.value) {
          // If status exists and has no error, assume success
          if (!txStatus.value.err) {
            this.logger.info({ txid }, 'Swap transaction verified successful (status check only)')
          }
        }
        else if (!parsedTx && !txStatus?.value) {
          // Neither status nor parsed tx available - this is suspicious
          this.logger.warn({ txid }, 'Could not verify transaction status or details after retries')
          // Don't throw - transaction might be valid but not yet indexed
          // But log a warning so we know something might be wrong
        }
        else if (parsedTx && !parsedTx.meta?.err) {
          // Parsed tx exists and has no errors - success!
          this.logger.info({ txid }, 'Swap transaction verified successful')
        }
      }
      catch (error: any) {
        // If WebSocket fails (403), transaction is still sent and will confirm eventually
        // But we still need to verify it succeeded
        if (error?.message?.includes('403') || error?.message?.includes('WebSocket')) {
          this.logger.warn(
            { txid, error: error.message },
            'Transaction confirmation WebSocket failed, verifying status separately',
          )

          // Wait a bit and then verify the transaction status with retries
          await new Promise(resolve => setTimeout(resolve, 3000))

          let txStatus = null
          const maxRetries = 5
          const retryDelay = 1000

          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              txStatus = await this.connection.getSignatureStatus(txid)
              if (txStatus?.value) {
                break
              }
            }
            catch {
              this.logger.debug({ txid, attempt: attempt + 1 }, 'Failed to get signature status, retrying...')
            }

            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, retryDelay))
            }
          }

          if (txStatus?.value?.err) {
            const errorMessage = JSON.stringify(txStatus.value.err)
            this.logger.error({ txid, error: txStatus.value.err }, 'Transaction failed')
            throw new Error(`Transaction failed: ${errorMessage}`)
          }

          // Also check parsed transaction with retries
          let parsedTx = null
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              parsedTx = await this.connection.getParsedTransaction(txid, {
                maxSupportedTransactionVersion: 0,
              })
              if (parsedTx) {
                break
              }
            }
            catch {
              this.logger.debug({ txid, attempt: attempt + 1 }, 'Failed to get parsed transaction, retrying...')
            }

            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, retryDelay))
            }
          }

          if (parsedTx?.meta?.err) {
            const errorMessage = JSON.stringify(parsedTx.meta.err)
            this.logger.error({ txid, error: parsedTx.meta.err }, 'Transaction has errors')
            throw new Error(`Transaction failed: ${errorMessage}`)
          }
          else if (!parsedTx) {
            this.logger.warn({ txid }, 'Could not verify transaction details, assuming success')
          }
        }
        else if (error?.message?.includes('Transaction failed')) {
          // Re-throw transaction failure errors
          throw error
        }
        else {
          // For other errors, still log but don't fail - transaction might still succeed
          this.logger.warn({ txid, error }, 'Transaction confirmation had issues, but transaction was sent')
        }
      }

      return txid
    }
    catch (error) {
      this.logger.error({ error }, 'Failed to send swap transaction')
      throw error
    }
  }

  /**
   * Resolve token address from symbol or address
   */
  resolveTokenAddress(tokenInput: string): string {
    // Check if it's a known symbol
    const upperInput = tokenInput.toUpperCase()
    if (this.COMMON_TOKENS[upperInput]) {
      return this.COMMON_TOKENS[upperInput]
    }

    // Assume it's already an address - validate it
    try {
      const pubkey = new PublicKey(tokenInput)
      // Check if it's a valid address
      pubkey.toBase58()
      return tokenInput
    }
    catch {
      throw new Error(`Invalid token: "${tokenInput}". Use a token symbol (SOL, USDC, etc.) or a valid address.`)
    }
  }

  /**
   * Check if token is verified by Jupiter
   */
  async isTokenVerified(mintAddress: string): Promise<boolean> {
    try {
      // Check if verified tokens cache is still valid
      const now = Date.now()
      if (
        this.verifiedTokensCache === null
        || now - this.verifiedTokensCacheTime > this.VERIFIED_CACHE_TTL
      ) {
        // Fetch verified tokens from Jupiter API
        const response = await fetch('https://lite-api.jup.ag/tokens/v2/tag?query=verified')
        if (!response.ok) {
          this.logger.warn({ status: response.status }, 'Failed to fetch verified tokens')
          return false
        }

        const data = await response.json()
        this.verifiedTokensCache = new Set(
          (data.tokens || []).map((token: any) => token.mint),
        )
        this.verifiedTokensCacheTime = now
      }

      return this.verifiedTokensCache.has(mintAddress)
    }
    catch (error) {
      this.logger.error({ error, mintAddress }, 'Failed to check if token is verified')
      return false
    }
  }

  /**
   * Get token risk information
   */
  async getTokenRiskInfo(mintAddress: string): Promise<TokenRiskInfo> {
    try {
      const isVerified = await this.isTokenVerified(mintAddress)

      // Check if token is tradable (has liquidity) by attempting to get a quote
      let isTradable = false
      try {
        // Try a small quote to see if token is tradable
        const testQuote = await this.getQuote(
          'So11111111111111111111111111111111111111112', // SOL
          mintAddress,
          1000000, // 0.001 SOL
          50,
        )
        isTradable = !!testQuote
      }
      catch {
        isTradable = false
      }

      // Try to get token metadata from Jupiter to check authorities
      let hasFreezeAuthority: boolean | null = null
      let mintAuthorityRevoked: boolean | null = null

      try {
        // Fetch token info from Jupiter's token list API
        const response = await fetch(`https://lite-api.jup.ag/tokens/v1/${mintAddress}`)
        if (response.ok) {
          const tokenData = await response.json()
          // mint_authority: null means revoked (safe)
          mintAuthorityRevoked = tokenData.mint_authority === null
          // freeze_authority: null means no freeze authority (safe)
          hasFreezeAuthority = tokenData.freeze_authority !== null
        }
      }
      catch (error) {
        this.logger.debug({ error, mintAddress }, 'Could not fetch token metadata for risk assessment')
      }

      // Determine risk level
      let riskLevel: 'verified' | 'tradable' | 'unknown'
      if (isVerified) {
        riskLevel = 'verified'
      }
      else if (isTradable) {
        riskLevel = 'tradable'
      }
      else {
        riskLevel = 'unknown'
      }

      return {
        isVerified,
        isTradable,
        hasFreezeAuthority,
        mintAuthorityRevoked,
        riskLevel,
      }
    }
    catch (error) {
      this.logger.error({ error, mintAddress }, 'Failed to get token risk info')
      return {
        isVerified: false,
        isTradable: false,
        hasFreezeAuthority: null,
        mintAuthorityRevoked: null,
        riskLevel: 'unknown',
      }
    }
  }

  /**
   * Derive the Metaplex metadata PDA for a mint address
   */
  private getMetadataPDA(mintAddress: string): PublicKey {
    const mint = new PublicKey(mintAddress)
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID,
    )
    return pda
  }

  /**
   * Parse Metaplex metadata from account data
   * Metadata structure (simplified):
   * - 1 byte: key
   * - 32 bytes: update authority
   * - 32 bytes: mint
   * - 4 bytes + string: name
   * - 4 bytes + string: symbol
   * - 4 bytes + string: uri
   */
  private parseMetadata(data: Buffer): { name: string, symbol: string, uri: string } | null {
    try {
      let offset = 1 + 32 + 32 // Skip key, update authority, mint

      // Read name (4-byte length prefix + string)
      const nameLen = data.readUInt32LE(offset)
      offset += 4
      const name = data.subarray(offset, offset + nameLen).toString('utf8').replace(/\0/g, '').trim()
      offset += nameLen

      // Read symbol (4-byte length prefix + string)
      const symbolLen = data.readUInt32LE(offset)
      offset += 4
      const symbol = data.subarray(offset, offset + symbolLen).toString('utf8').replace(/\0/g, '').trim()
      offset += symbolLen

      // Read uri (4-byte length prefix + string)
      const uriLen = data.readUInt32LE(offset)
      offset += 4
      const uri = data.subarray(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim()

      return { name, symbol, uri }
    }
    catch (error) {
      this.logger.debug({ error }, 'Failed to parse metadata')
      return null
    }
  }

  /**
   * Fetch token info from pump.fun API
   */
  private async getTokenInfoFromPumpFun(mintAddress: string): Promise<TokenInfo | null> {
    try {
      const response = await fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        this.logger.debug({ mintAddress, status: response.status }, 'pump.fun API returned non-OK status')
        return null
      }

      const data = await response.json()
      this.logger.debug({ mintAddress, data: { name: data.name, symbol: data.symbol } }, 'pump.fun API response')

      if (data.symbol) {
        return {
          address: mintAddress,
          symbol: data.symbol,
          name: data.name || data.symbol,
          decimals: 6, // pump.fun tokens always have 6 decimals
          logoURI: data.image_uri,
        }
      }

      return null
    }
    catch (error) {
      this.logger.debug({ error, mintAddress }, 'Failed to fetch from pump.fun API')
      return null
    }
  }

  /**
   * Fetch token info directly from Solana chain using Metaplex metadata or Token-2022 metadata extension
   */
  async getTokenInfoFromChain(mintAddress: string): Promise<TokenInfo | null> {
    try {
      const mint = new PublicKey(mintAddress)

      // Get mint info (supports both legacy SPL Token and Token-2022)
      const mintInfo = await this.getMintInfoWithFallback(mint)
      const decimals = mintInfo?.decimals ?? 9
      this.logger.debug({ mintAddress, decimals }, 'Resolved mint decimals from chain')

      // Try Token-2022 metadata extension first (used by pump.fun)
      const token2022Metadata = await this.getToken2022Metadata(mint)
      if (token2022Metadata) {
        const symbol = this.cleanMetadataString(token2022Metadata.symbol) || mintAddress.slice(0, 6).toUpperCase()
        const name = this.cleanMetadataString(token2022Metadata.name) || `Token ${mintAddress.slice(0, 8)}...`
        const uri = this.cleanMetadataString(token2022Metadata.uri)

        this.logger.info(
          { mintAddress, symbol, name, decimals, source: 'token-2022' },
          'Got token metadata from token-2022 extension',
        )

        return {
          address: mintAddress,
          symbol,
          name,
          decimals,
          logoURI: uri,
        }
      }

      // Fallback: Token Metadata program PDA (Metaplex standard)
      const metadata = await this.getMetaplexMetadata(mintAddress)
      if (metadata) {
        return {
          address: mintAddress,
          symbol: this.cleanMetadataString(metadata.symbol) || mintAddress.slice(0, 6).toUpperCase(),
          name: this.cleanMetadataString(metadata.name) || `Token ${mintAddress.slice(0, 8)}...`,
          decimals,
        }
      }

      // No metadata found; return placeholder
      return {
        address: mintAddress,
        symbol: mintAddress.slice(0, 6).toUpperCase(),
        name: `Token ${mintAddress.slice(0, 8)}...`,
        decimals,
      }
    }
    catch (error) {
      this.logger.warn({ error, mintAddress }, 'Failed to get token info from chain')
      return null
    }
  }

  private cleanMetadataString(value?: string | null): string {
    if (!value)
      return ''
    return value.replace(/\0/g, '').trim()
  }

  private async getMintInfoWithFallback(mint: PublicKey) {
    const attempt = async (programId: PublicKey) => {
      try {
        const mintInfo = await Promise.race([
          getMint(this.connection, mint, 'confirmed', programId),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Mint fetch timeout')), 5000),
          ),
        ])
        return mintInfo
      }
      catch (error) {
        this.logger.debug({ error, mint: mint.toBase58(), programId: programId.toBase58() }, 'Mint fetch failed for program')
        return null
      }
    }

    return (await attempt(TOKEN_PROGRAM_ID)) ?? (await attempt(TOKEN_2022_PROGRAM_ID))
  }

  private async getToken2022Metadata(mint: PublicKey) {
    try {
      const metadata = await Promise.race([
        getTokenMetadata(this.connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID),
        new Promise<null>(resolve =>
          setTimeout(() => resolve(null), 5000),
        ),
      ])
      return metadata
    }
    catch (error) {
      this.logger.debug({ error, mint: mint.toBase58() }, 'Token-2022 metadata not found')
      return null
    }
  }

  private async getMetaplexMetadata(mintAddress: string) {
    this.logger.debug({ mintAddress }, 'Fetching metadata PDA')
    const metadataPDA = this.getMetadataPDA(mintAddress)

    let metadataAccount
    try {
      metadataAccount = await Promise.race([
        this.connection.getAccountInfo(metadataPDA),
        new Promise<null>(resolve =>
          setTimeout(() => resolve(null), 5000),
        ),
      ])
    }
    catch (metaError) {
      this.logger.debug({ metaError, mintAddress }, 'Could not fetch metadata account')
    }

    if (!metadataAccount?.data) {
      this.logger.debug({ mintAddress }, 'No metadata account found or fetch timed out')
      return null
    }

    const metadata = this.parseMetadata(Buffer.from(metadataAccount.data))
    if (metadata) {
      this.logger.info({ mintAddress, symbol: metadata.symbol, name: metadata.name, source: 'metaplex' }, 'Got token metadata from chain')
    }

    return metadata
  }

  /**
   * Get token info (decimals, symbol, etc.)
   */
  async getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
    try {
      // Check cache first, but refetch if symbol looks like placeholder
      const cached = this.tokenCache.get(mintAddress)
      if (cached) {
        // Refetch if symbol is UNKNOWN or looks like truncated address
        const isPlaceholder = cached.symbol === 'UNKNOWN'
          || cached.symbol === mintAddress.slice(0, 6).toUpperCase()
          || cached.symbol === mintAddress.slice(0, 6)
        if (!isPlaceholder) {
          return cached
        }
        // Clear bad cache entry
        this.tokenCache.delete(mintAddress)
      }

      // For SOL
      if (mintAddress === this.COMMON_TOKENS.SOL) {
        const info: TokenInfo = {
          address: mintAddress,
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
        }
        this.tokenCache.set(mintAddress, info)
        return info
      }

      // Check if it's a known common token
      const knownSymbol = Object.keys(this.COMMON_TOKENS).find(
        key => this.COMMON_TOKENS[key] === mintAddress,
      )

      if (knownSymbol) {
        // Known decimals for common tokens
        const knownDecimals: Record<string, number> = {
          USDC: 6,
          USDT: 6,
          BONK: 5,
          JUP: 6,
          WIF: 6,
          PYTH: 6,
          JTO: 9,
        }

        const info: TokenInfo = {
          address: mintAddress,
          symbol: knownSymbol,
          name: knownSymbol,
          decimals: knownDecimals[knownSymbol] || 9,
        }
        this.tokenCache.set(mintAddress, info)
        return info
      }

      // Try to fetch from Jupiter API
      try {
        this.logger.debug({ mintAddress }, 'Fetching token info from Jupiter API')
        const response = await fetch(`https://lite-api.jup.ag/tokens/v1/${mintAddress}`)
        if (response.ok) {
          const tokenData = await response.json()
          this.logger.debug({ mintAddress, tokenData }, 'Jupiter API response')
          if (tokenData.symbol && tokenData.symbol !== 'UNKNOWN') {
            const info: TokenInfo = {
              address: mintAddress,
              symbol: tokenData.symbol,
              name: tokenData.name || tokenData.symbol || 'Unknown Token',
              decimals: tokenData.decimals || 9,
              logoURI: tokenData.logoURI,
            }
            this.tokenCache.set(mintAddress, info)
            return info
          }
        }
        else {
          this.logger.debug({ mintAddress, status: response.status }, 'Jupiter API returned non-OK status')
        }
      }
      catch (error) {
        this.logger.debug({ error, mintAddress }, 'Could not fetch token info from Jupiter API')
      }

      // Try pump.fun API for pump.fun tokens (address ends with "pump")
      if (mintAddress.toLowerCase().endsWith('pump')) {
        try {
          this.logger.debug({ mintAddress }, 'Fetching token info from pump.fun API')
          const pumpInfo = await this.getTokenInfoFromPumpFun(mintAddress)
          if (pumpInfo && pumpInfo.symbol !== 'UNKNOWN') {
            this.tokenCache.set(mintAddress, pumpInfo)
            return pumpInfo
          }
        }
        catch (error) {
          this.logger.debug({ error, mintAddress }, 'Could not fetch token info from pump.fun API')
        }
      }

      // Fallback: Fetch from Solana chain using Metaplex metadata
      try {
        this.logger.debug({ mintAddress }, 'Fetching token info from Solana chain')
        const chainInfo = await this.getTokenInfoFromChain(mintAddress)
        if (chainInfo) {
          this.logger.info({ mintAddress, chainInfo }, 'Got token info from chain')
          this.tokenCache.set(mintAddress, chainInfo)
          return chainInfo
        }
      }
      catch (error) {
        this.logger.warn({ error, mintAddress }, 'Could not fetch token info from chain')
      }

      // Final fallback: return basic info with UNKNOWN symbol
      const info: TokenInfo = {
        address: mintAddress,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9, // Default to 9 decimals
      }

      this.tokenCache.set(mintAddress, info)
      return info
    }
    catch (error) {
      this.logger.error({ error, mintAddress }, 'Failed to get token info')
      return null
    }
  }

  /**
   * Format token amount with decimals
   */
  formatTokenAmount(amount: bigint | string | number, decimals: number): string {
    const amountNum = typeof amount === 'bigint' ? Number(amount) : Number(amount)
    const value = amountNum / 10 ** decimals
    return value.toLocaleString(undefined, { maximumFractionDigits: decimals })
  }

  /**
   * Parse token amount to smallest unit
   */
  parseTokenAmount(amount: string | number, decimals: number): number {
    const amountNum = typeof amount === 'string' ? Number.parseFloat(amount) : amount
    return Math.floor(amountNum * 10 ** decimals)
  }

  /**
   * Calculate price impact percentage
   */
  calculatePriceImpact(quote: QuoteResponse): number {
    if (!quote.priceImpactPct) {
      return 0
    }
    return Number.parseFloat(quote.priceImpactPct)
  }

  /**
   * Check if price impact is acceptable
   */
  isPriceImpactAcceptable(quote: QuoteResponse, maxImpactPct: number = 5): boolean {
    const impact = this.calculatePriceImpact(quote)
    return Math.abs(impact) <= maxImpactPct
  }

  /**
   * Get token price in USD by getting a quote to USDC
   * @param tokenAddress Token mint address
   * @param knownDecimals Optional - if you already know the decimals, pass them to avoid incorrect pricing
   */
  async getTokenPriceInUSD(tokenAddress: string, knownDecimals?: number): Promise<number | null> {
    try {
      // For SOL, get quote from SOL to USDC
      if (tokenAddress === this.COMMON_TOKENS.SOL) {
        const quote = await this.getQuote(
          this.COMMON_TOKENS.SOL,
          this.COMMON_TOKENS.USDC,
          LAMPORTS_PER_SOL, // 1 SOL
          50, // 0.5% slippage
        )

        if (!quote)
          return null

        // USDC has 6 decimals, so divide by 1e6 to get USD price
        return Number(quote.outAmount) / 1e6
      }

      // For USDC, price is always $1
      if (tokenAddress === this.COMMON_TOKENS.USDC)
        return 1.0

      // Use known decimals if provided, otherwise try to fetch
      let decimals = knownDecimals
      if (decimals === undefined) {
        const tokenInfo = await this.getTokenInfo(tokenAddress)
        if (!tokenInfo)
          return null
        decimals = tokenInfo.decimals
      }

      // Get quote for 1 token unit
      const oneTokenUnit = 10 ** decimals
      const quote = await this.getQuote(
        tokenAddress,
        this.COMMON_TOKENS.USDC,
        oneTokenUnit,
        50, // 0.5% slippage
      )

      if (!quote)
        return null

      // USDC has 6 decimals, so divide by 1e6 to get USD price
      return Number(quote.outAmount) / 1e6
    }
    catch (error) {
      this.logger.error({ error, tokenAddress }, 'Failed to get token price in USD')
      return null
    }
  }
}
