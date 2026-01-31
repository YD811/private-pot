import type { QuoteResponse } from '@jup-ag/api'
import type { PublicKey } from '@solana/web3.js'
import type { TokenRiskInfo } from './jupiter.js'

export interface IJupiterService {
  COMMON_TOKENS: Record<string, string>

  getQuote: (
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps?: number,
  ) => Promise<QuoteResponse>

  executeSwap: (
    quote: QuoteResponse,
    userPublicKey: PublicKey,
    feeAccount?: string,
  ) => Promise<string>

  sendSwapTransaction: (
    swapTransactionBase64: string,
    wallet: any,
  ) => Promise<string>

  resolveTokenAddress: (tokenInput: string) => string

  calculatePriceImpact: (quote: QuoteResponse) => number

  isPriceImpactAcceptable: (quote: QuoteResponse, maxImpactPct?: number) => boolean

  formatTokenAmount: (amount: bigint | string | number, decimals: number) => string

  getTokenInfo: (mintAddress: string) => Promise<{
    address: string
    symbol: string
    name: string
    decimals: number
  } | null>

  parseTokenAmount: (amount: string | number, decimals: number) => number

  getTokenPriceInUSD: (tokenAddress: string, knownDecimals?: number) => Promise<number | null>

  getAssociatedTokenAccountAddress: (
    mintAddress: string,
    ownerPublicKey: PublicKey,
  ) => Promise<PublicKey>

  getPlatformFeeFromTransaction: (
    txSignature: string,
    feeAccountAddress: string,
    mintAddress: string,
  ) => Promise<bigint | null>

  isTokenVerified: (mintAddress: string) => Promise<boolean>

  getTokenRiskInfo: (mintAddress: string) => Promise<TokenRiskInfo>
}
