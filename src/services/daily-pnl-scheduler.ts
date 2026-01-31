import type { Logger } from '#root/logger.js'
import type { DailyPnLService } from './daily-pnl.js'

export class DailyPnLScheduler {
  private intervalId?: NodeJS.Timeout
  private timeoutId?: NodeJS.Timeout
  private isRunning = false

  constructor(
    private readonly dailyPnLService: DailyPnLService,
    private readonly logger: Logger,
  ) {}

  /**
   * Start the daily PnL scheduler
   * Records PnL once per day at midnight UTC
   */
  start() {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.logger.info('Daily PnL scheduler started')

    // Calculate time until next midnight UTC
    const now = new Date()
    const midnightUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ))

    const msUntilMidnight = midnightUTC.getTime() - now.getTime()

    // Schedule first run at midnight
    this.timeoutId = setTimeout(() => {
      this.recordDailyPnL()
      // Then schedule daily runs
      this.intervalId = setInterval(() => {
        this.recordDailyPnL()
      }, 24 * 60 * 60 * 1000) // 24 hours
    }, msUntilMidnight)
  }

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
    this.logger.info('Daily PnL scheduler stopped')
  }

  private async recordDailyPnL() {
    try {
      this.logger.info('Recording daily PnL for all groups')
      await this.dailyPnLService.recordDailyPnLForAllGroups()
      this.logger.info('Daily PnL recording completed')
    }
    catch (error) {
      this.logger.error({ error }, 'Failed to record daily PnL')
    }
  }
}
