import type { Logger } from '#root/logger.js'
import type { QuoteResponse } from '@jup-ag/api'
import type { IJupiterService } from './jupiter-interface.js'
import { PublicKey } from '@solana/web3.js'

/**
 * Mock Jupiter service for devnet testing
 * Simulates swaps without real execution
 */
export class MockJupiterService implements IJupiterService {
  public readonly COMMON_TOKENS: Record<string, string> = {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  }

  constructor(
    _rpcUrl: string,
    private readonly logger: Logger,
  ) {
    this.logger.warn('Using MOCK Jupiter service - trades will be simulated!')
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50,
  ): Promise<QuoteResponse> {
    // Simulate a 1:1000 SOL->BONK rate
    const baseOutAmount = inputMint === this.COMMON_TOKENS.SOL && outputMint === this.COMMON_TOKENS.BONK
      ? amount * 1000
      : amount

    // No platform fee - return full amount
    const mockOutAmount = baseOutAmount

    const quote: QuoteResponse = {
      inputMint,
      inAmount: String(amount),
      outputMint,
      outAmount: String(mockOutAmount),
      otherAmountThreshold: String(Math.floor(mockOutAmount * 0.995)),
      swapMode: 'ExactIn',
      slippageBps,
      priceImpactPct: '0.001',
      routePlan: [{
        swapInfo: {
          ammKey: 'MockPool',
          label: 'Mock DEX',
          inputMint,
          outputMint,
          inAmount: String(amount),
          outAmount: String(mockOutAmount),
          feeAmount: '0',
          feeMint: inputMint,
        },
        percent: 100,
      }],
      contextSlot: 0,
      timeTaken: 0.001,
    }

    this.logger.debug({ quote }, 'Mock Jupiter quote generated')
    return quote
  }

  async executeSwap(_quote: QuoteResponse, _userPublicKey: PublicKey, _feeAccount?: string): Promise<string> {
    // Return mock transaction
    return 'MOCK_TX_BASE64'
  }

  async getAssociatedTokenAccountAddress(
    mintAddress: string,
    ownerPublicKey: PublicKey,
  ): Promise<PublicKey> {
    // Mock: return a deterministic address based on mint and owner
    // In real implementation, this would use getAssociatedTokenAddress from @solana/spl-token
    const mockAddress = `MOCK_ATA_${mintAddress.slice(0, 8)}_${ownerPublicKey.toBase58().slice(0, 8)}`
    return new PublicKey(mockAddress)
  }

  async sendSwapTransaction(_swapTx: string, _wallet: any): Promise<string> {
    // Return mock signature
    const mockSignature = `MOCK${Math.random().toString(36).substring(2, 15).toUpperCase().repeat(4)}`
    this.logger.info({ txid: mockSignature }, 'Mock swap executed')
    return mockSignature
  }

  resolveTokenAddress(token: string): string {
    const upper = token.toUpperCase()
    return this.COMMON_TOKENS[upper] || token
  }

  calculatePriceImpact(_quote: QuoteResponse): number {
    return 0.001
  }

  isPriceImpactAcceptable(_quote: QuoteResponse, _maxImpact: number = 5): boolean {
    return true
  }

  formatTokenAmount(amount: bigint | string | number, decimals: number): string {
    const num = typeof amount === 'bigint' ? Number(amount) : Number(amount)
    return (num / 10 ** decimals).toLocaleString()
  }

  async getTokenInfo(_mintAddress: string) {
    return {
      address: _mintAddress,
      symbol: 'MOCK',
      name: 'Mock Token',
      decimals: 9,
    }
  }

  parseTokenAmount(amount: string | number, decimals: number): number {
    const num = typeof amount === 'string' ? Number.parseFloat(amount) : amount
    return Math.floor(num * 10 ** decimals)
  }

  async getTokenPriceInUSD(tokenAddress: string, _knownDecimals?: number): Promise<number | null> {
    // Mock prices for testing
    const mockPrices: Record<string, number> = {
      So11111111111111111111111111111111111111112: 100.0, // SOL = $100
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1.0, // USDC = $1
      DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 0.00001, // BONK = $0.00001
    }

    return mockPrices[tokenAddress] || null
  }

  async getPlatformFeeFromTransaction(
    _txSignature: string,
    _feeAccountAddress: string,
    _mintAddress: string,
  ): Promise<bigint | null> {
    // Mock: return null (fallback to calculation)
    return null
  }

  async isTokenVerified(mintAddress: string): Promise<boolean> {
    // Mock: COMMON_TOKENS are verified, others are not
    return Object.values(this.COMMON_TOKENS).includes(mintAddress)
  }

  async getTokenRiskInfo(mintAddress: string): Promise<{
    isVerified: boolean
    isTradable: boolean
    hasFreezeAuthority: boolean | null
    mintAuthorityRevoked: boolean | null
    riskLevel: 'verified' | 'tradable' | 'unknown'
  }> {
    const isVerified = await this.isTokenVerified(mintAddress)
    return {
      isVerified,
      isTradable: true, // Mock: all tokens are tradable
      hasFreezeAuthority: !isVerified, // Mock: unverified tokens have freeze authority
      mintAuthorityRevoked: isVerified, // Mock: verified tokens have mint authority revoked
      riskLevel: isVerified ? 'verified' : 'tradable',
    }
  }
}
