import type { Logger } from '#root/logger.js'

export interface RateLimitConfig {
  minRequestInterval?: number
  maxRetries?: number
  baseRetryDelay?: number
  maxConsecutiveRateLimits?: number
  maxRetryDelay?: number // Maximum delay in milliseconds (default: 5 minutes)
  circuitBreakerThreshold?: number // Stop retrying after this many consecutive errors (default: 100)
}

export class RPCRateLimiter {
  private static instance: RPCRateLimiter
  private lastRequestTime = 0
  private consecutiveRateLimitErrors = 0
  private readonly minRequestInterval: number
  private readonly maxRetries: number
  private readonly baseRetryDelay: number
  private readonly maxConsecutiveRateLimits: number
  private readonly maxRetryDelay: number
  private readonly circuitBreakerThreshold: number

  /**
   * Constructor - use getInstance() for singleton (write operations)
   * or new RPCRateLimiter() for separate instances (read-only operations)
   */
  constructor(
    private readonly logger: Logger,
    config: RateLimitConfig = {},
  ) {
    this.minRequestInterval = config.minRequestInterval ?? 2000 // 2 seconds default
    this.maxRetries = config.maxRetries ?? 3
    this.baseRetryDelay = config.baseRetryDelay ?? 10000 // 10 seconds default
    this.maxConsecutiveRateLimits = config.maxConsecutiveRateLimits ?? 5
    this.maxRetryDelay = config.maxRetryDelay ?? 300000 // 5 minutes default
    this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? 100
  }

  /**
   * Get the singleton instance
   */
  static getInstance(logger?: Logger, config?: RateLimitConfig): RPCRateLimiter {
    if (!RPCRateLimiter.instance) {
      if (!logger) {
        throw new Error('Logger is required for first initialization')
      }
      RPCRateLimiter.instance = new RPCRateLimiter(logger, config)
    }
    return RPCRateLimiter.instance
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static reset(): void {
    RPCRateLimiter.instance = undefined as any
  }

  /**
   * Ensure minimum time between requests
   */
  async waitForRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
    this.lastRequestTime = Date.now()
  }

  /**
   * Execute an RPC operation with rate limiting and retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    // Circuit breaker: if we've hit too many consecutive errors, fail fast
    if (this.consecutiveRateLimitErrors >= this.circuitBreakerThreshold) {
      const error = new Error(
        `Circuit breaker open: ${this.consecutiveRateLimitErrors} consecutive rate limit errors. `
        + `Stopping retries to prevent system overload.`,
      )
      this.logger.error(
        {
          operationName,
          consecutiveErrors: this.consecutiveRateLimitErrors,
          circuitBreakerThreshold: this.circuitBreakerThreshold,
        },
        'Circuit breaker triggered - too many consecutive rate limit errors',
      )
      throw error
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.waitForRateLimit()
        const result = await operation()

        // Reset counter on successful request (even if not first attempt)
        this.consecutiveRateLimitErrors = 0

        return result
      }
      catch (error: any) {
        lastError = error

        // Check if it's a rate limit error
        const isRateLimit = this.isRateLimitError(error)

        if (isRateLimit && attempt < this.maxRetries) {
          this.consecutiveRateLimitErrors++

          // Check circuit breaker again after incrementing
          if (this.consecutiveRateLimitErrors >= this.circuitBreakerThreshold) {
            this.logger.error(
              {
                operationName,
                consecutiveErrors: this.consecutiveRateLimitErrors,
                attempt: attempt + 1,
              },
              'Circuit breaker triggered during retry - stopping',
            )
            throw new Error(
              `Circuit breaker open: ${this.consecutiveRateLimitErrors} consecutive rate limit errors`,
            )
          }

          // Get delay from Retry-After header or use exponential backoff
          const baseDelay = this.extractRetryDelay(error)
          const jitter = Math.random() * 1000 // Add up to 1 second random jitter
          let delay = baseDelay + jitter

          // Cap delay to prevent Infinity and reasonable maximum
          delay = Math.min(delay, this.maxRetryDelay)
          delay = Math.max(delay, 1000) // Minimum 1 second

          // Validate delay is a finite number
          if (!Number.isFinite(delay) || delay <= 0) {
            this.logger.error(
              {
                operationName,
                calculatedDelay: delay,
                baseDelay,
                consecutiveErrors: this.consecutiveRateLimitErrors,
              },
              'Invalid delay calculated, using maximum delay',
            )
            delay = this.maxRetryDelay
          }

          this.logger.warn(
            {
              attempt: attempt + 1,
              delay: Math.round(delay),
              operationName,
              consecutiveErrors: this.consecutiveRateLimitErrors,
              retryAfter: error?.retryAfter || error?.response?.headers?.get('retry-after'),
            },
            'Rate limit hit, retrying after delay',
          )

          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        // For non-rate-limit errors or final attempt, throw
        throw error
      }
    }

    throw lastError || new Error(`Failed after ${this.maxRetries} retries`)
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    return error?.message?.includes('429')
      || error?.message?.includes('Too Many Requests')
      || error?.status === 429
      || error?.response?.status === 429
      || error?.code === 429
  }

  /**
   * Extract retry delay from error or use default
   */
  private extractRetryDelay(error: any): number {
    // First try: direct retryAfter property
    if (error?.retryAfter) {
      const delay = this.parseRetryAfter(error.retryAfter)
      if (delay > 0) {
        return delay
      }
    }

    // Second try: from response headers
    if (error?.response?.headers) {
      const retryAfter = error.response.headers.get('retry-after')
      if (retryAfter) {
        const delay = this.parseRetryAfter(retryAfter)
        if (delay > 0) {
          return delay
        }
      }
    }

    // Check if error message contains retry information
    const retryMatch = error?.message?.match(/retry\s+after\s+(\d+)\s*(ms|seconds?|sec)/i)
    if (retryMatch) {
      const delay = Number.parseInt(retryMatch[1], 10)
      const unit = retryMatch[2]?.toLowerCase()
      if (!Number.isNaN(delay)) {
        if (unit?.includes('ms')) {
          return delay
        }
        return delay * 1000 // Assume seconds
      }
    }

    // Fall back to exponential backoff with cap
    // Cap the exponent to prevent overflow (2^20 is already 1M, way more than needed)
    const cappedExponent = Math.min(this.consecutiveRateLimitErrors, 20)
    const exponentialDelay = this.baseRetryDelay * (2 ** cappedExponent)

    // Cap to maximum retry delay
    return Math.min(exponentialDelay, this.maxRetryDelay)
  }

  /**
   * Parse Retry-After header value
   */
  private parseRetryAfter(retryAfter: string): number {
    // Try parsing as number (seconds)
    const numeric = Number.parseInt(retryAfter, 10)
    if (!Number.isNaN(numeric)) {
      // If it's a reasonable number (< 1 hour), treat as seconds
      if (numeric < 3600) {
        return numeric * 1000
      }
      // Otherwise might be a timestamp
      const now = Date.now()
      const delay = numeric - now
      if (delay > 0 && delay < 3600000) { // Less than 1 hour
        return delay
      }
    }

    // Try parsing as HTTP date
    const date = new Date(retryAfter)
    if (!Number.isNaN(date.getTime())) {
      const delay = date.getTime() - Date.now()
      if (delay > 0 && delay < 3600000) { // Less than 1 hour
        return delay
      }
    }

    return 0 // Invalid or couldn't parse
  }

  /**
   * Check if we should skip operations due to too many rate limits
   */
  shouldSkip(): boolean {
    return this.consecutiveRateLimitErrors >= this.maxConsecutiveRateLimits
  }

  /**
   * Check if circuit breaker is open (too many consecutive errors)
   */
  isCircuitBreakerOpen(): boolean {
    return this.consecutiveRateLimitErrors >= this.circuitBreakerThreshold
  }

  /**
   * Reset consecutive error counter
   */
  resetErrors(): void {
    this.consecutiveRateLimitErrors = 0
  }

  /**
   * Get current consecutive error count
   */
  getConsecutiveErrors(): number {
    return this.consecutiveRateLimitErrors
  }
}
