import type { Logger } from '#root/logger.js'
import { DailyPnLScheduler } from '#root/services/daily-pnl-scheduler.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('dailyPnLScheduler', () => {
  let mockDailyPnLService: any
  let mockLogger: Logger
  let scheduler: DailyPnLScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    mockDailyPnLService = {
      recordDailyPnLForAllGroups: vi.fn().mockResolvedValue(undefined),
    }

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any

    scheduler = new DailyPnLScheduler(mockDailyPnLService, mockLogger)
  })

  afterEach(() => {
    scheduler.stop()
    vi.useRealTimers()
  })

  it('starts the scheduler', () => {
    scheduler.start()

    expect(mockLogger.info).toHaveBeenCalledWith('Daily PnL scheduler started')
    // isRunning is private, so we verify by checking that stop() works
    scheduler.stop()
    expect(mockLogger.info).toHaveBeenCalledWith('Daily PnL scheduler stopped')
  })

  it('does not start if already running', () => {
    scheduler.start()
    const firstCallCount = vi.mocked(mockLogger.info).mock.calls.length

    scheduler.start()
    const secondCallCount = vi.mocked(mockLogger.info).mock.calls.length

    // Should only log once
    expect(secondCallCount).toBe(firstCallCount)
  })

  it('schedules daily PnL recording at midnight UTC', async () => {
    // Set time to 10:00 AM UTC
    const now = new Date('2025-01-15T10:00:00Z')
    vi.setSystemTime(now)

    scheduler.start()

    // Calculate ms until midnight (14 hours = 14 * 60 * 60 * 1000)
    const msUntilMidnight = 14 * 60 * 60 * 1000

    // Should not have been called yet
    expect(mockDailyPnLService.recordDailyPnLForAllGroups).not.toHaveBeenCalled()

    // Fast-forward to just before midnight
    vi.advanceTimersByTime(msUntilMidnight - 1000)
    expect(mockDailyPnLService.recordDailyPnLForAllGroups).not.toHaveBeenCalled()

    // Fast-forward past midnight
    vi.advanceTimersByTime(2000)
    await vi.runOnlyPendingTimersAsync()

    // Should be called
    expect(mockDailyPnLService.recordDailyPnLForAllGroups).toHaveBeenCalled()
  })

  it('records PnL daily after first run', async () => {
    // Set time to midnight UTC
    const midnight = new Date('2025-01-16T00:00:00Z')
    vi.setSystemTime(midnight)

    scheduler.start()

    // Fast-forward 24 hours (but only run pending timers, not all)
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    await vi.runOnlyPendingTimersAsync()

    // Should be called at least once
    expect(mockDailyPnLService.recordDailyPnLForAllGroups).toHaveBeenCalled()
  })

  it('handles errors gracefully', async () => {
    const error = new Error('Failed to record')
    vi.mocked(mockDailyPnLService.recordDailyPnLForAllGroups).mockRejectedValue(error)

    // Set time to midnight
    const midnight = new Date('2025-01-16T00:00:00Z')
    vi.setSystemTime(midnight)

    scheduler.start()

    // Fast-forward past midnight (only run pending timers)
    vi.advanceTimersByTime(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(mockLogger.error).toHaveBeenCalledWith(
      { error },
      'Failed to record daily PnL',
    )
  })

  it('stops the scheduler', () => {
    scheduler.start()
    scheduler.stop()

    expect(mockLogger.info).toHaveBeenCalledWith('Daily PnL scheduler stopped')
  })

  it('stops gracefully when not running', () => {
    scheduler.stop()
    // Should not throw
    expect(mockLogger.info).toHaveBeenCalledWith('Daily PnL scheduler stopped')
  })
})
