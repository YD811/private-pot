import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { withdrawFeature } from '#root/bot/features/withdraw.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

describe('withdrawFeature', () => {
  let mockPrisma: PrismaClient
  let mockWalletService: WalletService
  const mockSolanaRpcUrl = 'https://api.devnet.solana.com'

  beforeEach(() => {
    mockPrisma = {
      group: {
        findUnique: vi.fn(),
      },
      member: {
        update: vi.fn(),
      },
      withdrawal: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    } as any

    mockWalletService = {
      restoreWallet: vi.fn(),
    } as any
  })

  describe('withdraw command validations', () => {
    it('rejects command in private chat', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'withdraw' })
      ctx.reply = vi.fn()

      await withdrawFeature(mockPrisma, mockWalletService, mockSolanaRpcUrl).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('only available in group chats'),
      )
    })

    it('shows help message when arguments are missing', async () => {
      const ctx = createMockContext({ chatType: 'supergroup', command: 'withdraw' })
      ctx.reply = vi.fn()
      ctx.match = ''

      await withdrawFeature(mockPrisma, mockWalletService, mockSolanaRpcUrl).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Usage')
      expect(replyCall).toContain('withdraw')
    })

    it('shows help message when only amount provided', async () => {
      const ctx = createMockContext({ chatType: 'supergroup', command: 'withdraw' })
      ctx.reply = vi.fn()
      ctx.match = '0.5'

      await withdrawFeature(mockPrisma, mockWalletService, mockSolanaRpcUrl).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Usage')
    })
  })
})
