import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { adminTradingFeature } from '#root/bot/features/admin-trading.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

describe('adminTradingFeature', () => {
  let mockPrisma: PrismaClient
  let mockWalletService: WalletService

  beforeEach(() => {
    mockPrisma = {
      group: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      member: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    } as any

    mockWalletService = {
      createUserDepositWallet: vi.fn(),
    } as any
  })

  function createMockGroup(overrides = {}) {
    return {
      id: 'group-1',
      telegramGroupId: '-100123456789',
      totalDeposits: BigInt(1000000000), // 1 SOL
      isPaused: false,
      ...overrides,
    }
  }

  function createMockMember(overrides = {}) {
    return {
      id: 'member-1',
      groupId: 'group-1',
      telegramUserId: '987654321',
      telegramUsername: 'trader',
      deposits: BigInt(500000000), // 0.5 SOL
      isTrader: false,
      ...overrides,
    }
  }

  describe('/add_trader command', () => {
    it('rejects command in private chat', async () => {
      const ctx = createMockContext({
        chatType: 'private',
        userId: 123456789,
        command: 'add_trader',
      })
      ctx.reply = vi.fn()

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        'This command is only available in group chats.',
      )
    })

    it('rejects non-admin users', async () => {
      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'add_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Only group administrators'),
      )
    })

    it('shows help when no reply-to-message provided', async () => {
      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'add_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Usage:')
      expect(replyCall).toContain('Reply to a user\'s message')
    })

    it('rejects when group is not initialized', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'add_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])
      ctx.message!.reply_to_message = {
        message_id: 2,
        date: Date.now() / 1000,
        chat: ctx.chat,
        from: { id: 987654321, username: 'trader', is_bot: false, first_name: 'Trader' },
      } as any

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('not been initialized yet'),
      )
    })

    it('creates member and adds trader when user is not a member', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(createMockGroup() as any)
      vi.mocked(mockWalletService.createUserDepositWallet).mockReturnValue({
        publicKey: 'generated_wallet_address',
        encryptedPrivateKey: 'encrypted_key',
        iv: 'encryption_iv',
      })

      // Mock the transaction
      const mockTransaction = {
        member: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(createMockMember() as any),
          update: vi.fn().mockResolvedValue(createMockMember({ isTrader: true }) as any),
        },
      }
      vi.mocked(mockPrisma.$transaction).mockImplementation(async (callback) => {
        return callback(mockTransaction as any)
      })

      // Mock findMany to return all traders (including the one we just added)
      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([
        createMockMember({ isTrader: true, telegramUsername: 'trader' }),
      ] as any)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'add_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])
      ctx.message!.reply_to_message = {
        message_id: 2,
        date: Date.now() / 1000,
        chat: ctx.chat,
        from: { id: 987654321, username: 'trader', is_bot: false, first_name: 'Trader' },
      } as any

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(mockWalletService.createUserDepositWallet).toHaveBeenCalledWith('group-1', '987654321')
      expect(mockTransaction.member.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          groupId: 'group-1',
          telegramUserId: '987654321',
          telegramUsername: 'trader',
          deposits: BigInt(0),
          isTrader: false,
          depositAddress: 'generated_wallet_address',
          encryptedPrivateKey: 'encrypted_key',
          encryptionIv: 'encryption_iv',
        }),
      })
      expect(mockTransaction.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { isTrader: true },
      })
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Trader Added!')
    })

    it('successfully adds trader permission', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(createMockGroup() as any)

      // Mock the transaction
      const mockTransaction = {
        member: {
          findUnique: vi.fn().mockResolvedValue(createMockMember() as any),
          update: vi.fn().mockResolvedValue(createMockMember({ isTrader: true }) as any),
        },
      }
      vi.mocked(mockPrisma.$transaction).mockImplementation(async (callback) => {
        return callback(mockTransaction as any)
      })

      // Mock findMany to return all traders (including the one we just added)
      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([
        createMockMember({ isTrader: true, telegramUsername: 'trader' }),
      ] as any)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'add_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])
      ctx.message!.reply_to_message = {
        message_id: 2,
        date: Date.now() / 1000,
        chat: ctx.chat,
        from: { id: 987654321, username: 'trader', is_bot: false, first_name: 'Trader' },
      } as any

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(mockTransaction.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { isTrader: true },
      })
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Trader Added!')
    })
  })

  describe('/remove_trader command', () => {
    it('rejects non-admin users', async () => {
      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'remove_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Only group administrators'),
      )
    })

    it('successfully removes trader permission', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(createMockGroup() as any)
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValue(
        createMockMember({ isTrader: true }) as any,
      )
      vi.mocked(mockPrisma.member.update).mockResolvedValue(createMockMember() as any)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'remove_trader',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])
      ctx.message!.reply_to_message = {
        message_id: 2,
        date: Date.now() / 1000,
        chat: ctx.chat,
        from: { id: 987654321, username: 'trader', is_bot: false, first_name: 'Trader' },
      } as any

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(mockPrisma.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { isTrader: false },
      })
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Trader Removed')
    })
  })

  describe('/pause command', () => {
    it('rejects non-admin users', async () => {
      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'pause',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Only group administrators'),
      )
    })

    it('successfully pauses trading', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(createMockGroup() as any)
      vi.mocked(mockPrisma.group.update).mockResolvedValue(
        createMockGroup({ isPaused: true }) as any,
      )

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'pause',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(mockPrisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { isPaused: true },
      })
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Trading Paused')
    })
  })

  describe('/unpause command', () => {
    it('rejects non-admin users', async () => {
      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'unpause',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Only group administrators'),
      )
    })

    it('successfully resumes trading', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(createMockGroup() as any)
      vi.mocked(mockPrisma.group.update).mockResolvedValue(
        createMockGroup({ isPaused: false }) as any,
      )

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -100123456789,
        userId: 123456789,
        command: 'unpause',
      })
      ctx.reply = vi.fn()
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])

      await adminTradingFeature(mockPrisma, mockWalletService).middleware()(ctx, vi.fn())

      expect(mockPrisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { isPaused: false },
      })
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Trading Resumed')
    })
  })
})
