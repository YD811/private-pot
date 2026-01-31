import type { Logger } from '#root/logger.js'
import type { PrismaClient } from '@prisma/client'
import type { GroupPnL, GroupService } from './group.js'
import type { IJupiterService } from './jupiter-interface.js'
import type { TokenBalanceService } from './token-balance.js'

export class PnLCacheService {
  private static instance: PnLCacheService
  private intervalId?: NodeJS.Timeout
  private timeoutId?: NodeJS.Timeout
  private isRunning = false

  constructor(
    private readonly prisma: PrismaClient,
    private readonly groupService: GroupService,
    private readonly jupiterService: IJupiterService,
    private readonly tokenBalanceService: TokenBalanceService,
    private readonly logger: Logger,
    private readonly intervalMinutes: number = 10,
  ) {
    PnLCacheService.instance = this
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): PnLCacheService | null {
    return PnLCacheService.instance || null
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static reset(): void {
    PnLCacheService.instance = undefined as any
  }

  /**
   * Start the PnL cache updater
   * Calculates PnL for all groups every N minutes
   */
  start() {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.logger.info({ intervalMinutes: this.intervalMinutes }, 'PnL cache service started')

    // Calculate immediately on start
    this.updateAllGroups()

    // Then schedule periodic updates
    this.intervalId = setInterval(() => {
      this.updateAllGroups()
    }, this.intervalMinutes * 60 * 1000)
  }

  /**
   * Stop the PnL cache updater
   */
  stop() {
    this.isRunning = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    this.logger.info('PnL cache service stopped')
  }

  /**
   * Update PnL cache for all groups
   */
  private async updateAllGroups() {
    if (!this.isRunning) {
      return
    }

    // Check if circuit breaker is open - skip update if RPC is rate limited
    const rateLimiter = await this.getRateLimiter()
    if (rateLimiter?.isCircuitBreakerOpen()) {
      this.logger.warn(
        {
          consecutiveErrors: rateLimiter.getConsecutiveErrors(),
        },
        'Skipping PnL cache update - circuit breaker is open',
      )
      return
    }

    try {
      this.logger.debug('Starting PnL cache update for all groups')

      const groups = await this.prisma.group.findMany({
        where: { isPaused: false }, // Only active groups
        select: { id: true },
      })

      this.logger.debug({ groupCount: groups.length }, 'Updating PnL cache for groups')

      // Process groups sequentially to avoid overwhelming RPC
      for (const group of groups) {
        if (!this.isRunning) {
          break
        }

        // Check circuit breaker before each group (re-check in case it opened)
        const currentRateLimiter = await this.getRateLimiter()
        if (currentRateLimiter?.isCircuitBreakerOpen()) {
          this.logger.warn(
            {
              consecutiveErrors: currentRateLimiter.getConsecutiveErrors(),
              processedGroups: groups.indexOf(group),
            },
            'Stopping PnL cache update - circuit breaker opened during processing',
          )
          break
        }

        try {
          await this.updateGroupCache(group.id)
        }
        catch (error: any) {
          // If circuit breaker opened, stop processing
          if (error?.circuitBreakerOpen) {
            const currentRateLimiter = await this.getRateLimiter()
            this.logger.warn(
              {
                consecutiveErrors: currentRateLimiter?.getConsecutiveErrors(),
                processedGroups: groups.indexOf(group),
              },
              'Stopping PnL cache update - circuit breaker opened',
            )
            break
          }
          this.logger.error({ error, groupId: group.id }, 'Failed to update PnL cache for group')
        }
      }

      this.logger.debug('Completed PnL cache update for all groups')
    }
    catch (error) {
      this.logger.error({ error }, 'Error updating PnL cache for all groups')
    }
  }

  /**
   * Get rate limiter instance (if available)
   */
  private async getRateLimiter() {
    // Try to get rate limiter from RPCRateLimiter singleton
    // This is a bit of a hack, but we need to check circuit breaker status
    try {
      const { RPCRateLimiter } = await import('./rpc-rate-limiter.js')
      return RPCRateLimiter.getInstance()
    }
    catch {
      return null
    }
  }

  /**
   * Update PnL cache for a specific group
   */
  async updateGroupCache(groupId: string): Promise<void> {
    try {
      const pnl = await this.groupService.calculateGroupPnL(
        groupId,
        this.jupiterService,
        this.tokenBalanceService,
      )

      await this.prisma.group.update({
        where: { id: groupId },
        data: {
          cachedPnLAmount: pnl.pnlAmount,
          cachedPnLPercent: pnl.pnlPercent,
          cachedCurrentValue: pnl.currentValue,
          cachedPnLUpdatedAt: new Date(),
        },
      })
    }
    catch (error) {
      this.logger.error({ error, groupId }, 'Failed to calculate and cache PnL for group')
      throw error
    }
  }

  /**
   * Get cached PnL for a group
   * Returns null if cache is stale (older than interval) or doesn't exist
   */
  async getCachedPnL(groupId: string): Promise<GroupPnL | null> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        totalDeposits: true,
        cachedPnLAmount: true,
        cachedPnLPercent: true,
        cachedCurrentValue: true,
        cachedPnLUpdatedAt: true,
      },
    })

    if (!group) {
      return null
    }

    // Check if cache exists and is fresh
    if (
      group.cachedPnLAmount === null
      || group.cachedPnLPercent === null
      || group.cachedCurrentValue === null
      || group.cachedPnLUpdatedAt === null
    ) {
      return null
    }

    // Check if cache is stale (older than interval)
    const cacheAge = Date.now() - group.cachedPnLUpdatedAt.getTime()
    const maxAge = this.intervalMinutes * 60 * 1000

    if (cacheAge > maxAge) {
      return null
    }

    // Return cached PnL
    return {
      totalDeposits: group.totalDeposits,
      currentValue: group.cachedCurrentValue,
      pnlAmount: group.cachedPnLAmount,
      pnlPercent: group.cachedPnLPercent,
      solBalance: group.cachedCurrentValue, // Approximate, but cached value includes tokens
      tokenPositions: [], // Not cached, but not needed for most use cases
    }
  }

  /**
   * Invalidate cache for a group (e.g., after a trade)
   */
  async invalidateCache(groupId: string): Promise<void> {
    await this.prisma.group.update({
      where: { id: groupId },
      data: {
        cachedPnLUpdatedAt: null, // Setting to null marks as stale
      },
    })
  }
}
