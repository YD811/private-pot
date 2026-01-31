import type { Logger } from '#root/logger.js'
import type { RPCRateLimiter } from './rpc-rate-limiter.js'
import { Connection } from '@solana/web3.js'

/**
 * RPC Rotator - Manages rotation across multiple RPC endpoints
 * Automatically rotates to next URL on failure and retries
 */
export class RPCRotator {
  private readonly urls: string[]
  private currentIndex = 0
  private readonly rateLimiter: RPCRateLimiter
  private readonly logger: Logger

  constructor(
    rpcUrls: string | string[],
    rateLimiter: RPCRateLimiter,
    logger: Logger,
  ) {
    // Parse comma-separated string or use array directly
    if (typeof rpcUrls === 'string') {
      this.urls = rpcUrls.split(',').map(url => url.trim()).filter(Boolean)
    }
    else {
      this.urls = rpcUrls
    }

    if (this.urls.length === 0) {
      throw new Error('At least one RPC URL is required')
    }

    this.rateLimiter = rateLimiter
    this.logger = logger
  }

  /**
   * Get the current RPC URL
   */
  getCurrentUrl(): string {
    return this.urls[this.currentIndex]
  }

  /**
   * Rotate to the next RPC URL
   */
  rotate(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length
    this.logger.debug(
      { currentUrl: this.getCurrentUrl(), index: this.currentIndex },
      'Rotated to next RPC URL',
    )
  }

  /**
   * Get all RPC URLs
   */
  getUrls(): string[] {
    return [...this.urls]
  }

  /**
   * Create a Connection with rotation support
   * Automatically rotates to next URL on rate limit errors
   */
  createConnection(commitment: 'confirmed' | 'finalized' = 'confirmed'): Connection {
    // Create connection with the first URL, but use custom fetch to handle rotation
    return new Connection(this.getCurrentUrl(), {
      commitment,
      fetch: async (url, options) => {
        // Check circuit breaker before making request
        if (this.rateLimiter.isCircuitBreakerOpen()) {
          const error: any = new Error(
            `Circuit breaker open: ${this.rateLimiter.getConsecutiveErrors()} consecutive rate limit errors. `
            + 'RPC requests are temporarily disabled to prevent system overload.',
          )
          error.status = 503 // Service Unavailable
          error.circuitBreakerOpen = true
          throw error
        }

        await this.rateLimiter.waitForRateLimit()

        let lastError: Error | null = null
        const maxAttempts = this.urls.length

        // Try each RPC URL in rotation
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const currentUrl = this.getCurrentUrl()
            // Extract the path from the original URL and construct new URL with current RPC endpoint
            const urlObj = new URL(url.toString())
            const newUrl = new URL(urlObj.pathname + urlObj.search, currentUrl)

            const response = await fetch(newUrl.toString(), options)

            // If we get a 429, rotate to next URL and retry
            if (response.status === 429) {
              this.logger.warn(
                { url: currentUrl, attempt: attempt + 1 },
                'Rate limit hit on RPC, rotating to next',
              )
              this.rotate()

              // If this was the last attempt, throw the error
              if (attempt === maxAttempts - 1) {
                const retryAfter = response.headers.get('retry-after')
                const error: any = new Error(`429 Too Many Requests: ${response.statusText}`)
                error.status = 429
                error.response = {
                  status: 429,
                  headers: response.headers,
                  statusText: response.statusText,
                }
                error.retryAfter = retryAfter
                throw error
              }

              // Wait a bit before retrying with next URL
              await new Promise(resolve => setTimeout(resolve, 1000))
              continue
            }

            // Success - return response
            return response
          }
          catch (error: any) {
            lastError = error

            // If it's a rate limit error and we have more URLs to try, rotate
            if (error?.status === 429 && attempt < maxAttempts - 1) {
              this.rotate()
              await new Promise(resolve => setTimeout(resolve, 1000))
              continue
            }

            // For other errors, if we have more URLs, try next one
            if (attempt < maxAttempts - 1) {
              this.logger.warn(
                { error: error.message, url: this.getCurrentUrl(), attempt: attempt + 1 },
                'RPC request failed, rotating to next',
              )
              this.rotate()
              await new Promise(resolve => setTimeout(resolve, 500))
              continue
            }

            // Last attempt failed, throw error
            throw error
          }
        }

        throw lastError || new Error('All RPC URLs failed')
      },
    })
  }
}
