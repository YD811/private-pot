import type { PrismaClient } from '@prisma/client'
import type { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'
import { TransactionMonitorService } from '#root/services/transaction-monitor.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('transactionMonitorService', () => {
  let mockConnection: Connection
  let mockPrisma: PrismaClient
  let monitorService: TransactionMonitorService

  beforeEach(() => {
    mockConnection = {
      getSignaturesForAddress: vi.fn(),
      getParsedTransaction: vi.fn(),
    } as any

    mockPrisma = {
      depositCode: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      deposit: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      member: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
      group: {
        update: vi.fn(),
      },
    } as any

    monitorService = new TransactionMonitorService(mockConnection, mockPrisma)
  })

  describe('extractMemoFromTransaction', () => {
    it('should extract memo from transaction', () => {
      const mockTx: Partial<ParsedTransactionWithMeta> = {
        transaction: {
          message: {
            instructions: [
              {
                programId: { toBase58: () => 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' } as PublicKey,
                parsed: 'ABC12345',
              },
            ],
          },
        },
      } as any

      const memo = monitorService.extractMemoFromTransaction(mockTx as ParsedTransactionWithMeta)

      expect(memo).toBe('ABC12345')
    })

    it('should return null if no memo program', () => {
      const mockTx: Partial<ParsedTransactionWithMeta> = {
        transaction: {
          message: {
            instructions: [
              {
                programId: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' } as PublicKey,
              },
            ],
          },
        },
      } as any

      const memo = monitorService.extractMemoFromTransaction(mockTx as ParsedTransactionWithMeta)

      expect(memo).toBeNull()
    })

    it('should return null if no instructions', () => {
      const mockTx: Partial<ParsedTransactionWithMeta> = {
        transaction: {
          message: {
            instructions: [],
          },
        },
      } as any

      const memo = monitorService.extractMemoFromTransaction(mockTx as ParsedTransactionWithMeta)

      expect(memo).toBeNull()
    })
  })

  describe('getTransactionAmount', () => {
    it('should calculate SOL transfer amount', () => {
      const mockTx: Partial<ParsedTransactionWithMeta> = {
        meta: {
          preBalances: [1000000000, 500000000],
          postBalances: [900000000, 600000000],
        },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => 'sender' } as PublicKey },
              { pubkey: { toBase58: () => 'receiver' } as PublicKey },
            ],
          },
        },
      } as any

      const amount = monitorService.getTransactionAmount(
        mockTx as ParsedTransactionWithMeta,
        'receiver',
      )

      expect(amount).toBe(100000000n)
    })

    it('should return 0n if recipient not found', () => {
      const mockTx: Partial<ParsedTransactionWithMeta> = {
        meta: {
          preBalances: [1000000000, 500000000],
          postBalances: [900000000, 600000000],
        },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: { toBase58: () => 'sender' } as PublicKey },
              { pubkey: { toBase58: () => 'receiver' } as PublicKey },
            ],
          },
        },
      } as any

      const amount = monitorService.getTransactionAmount(
        mockTx as ParsedTransactionWithMeta,
        'unknown',
      )

      expect(amount).toBe(0n)
    })
  })

  describe('processDeposit', () => {
    it('should process valid deposit', async () => {
      const depositCode = {
        id: 'code-1',
        groupId: 'group-1',
        telegramUserId: '123456789',
        used: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      }

      const member = {
        id: 'member-1',
        groupId: 'group-1',
        deposits: 0n,
        depositAddress: 'UserDepositAddress123',
      }

      vi.mocked(mockPrisma.depositCode.findUnique).mockResolvedValue(depositCode as any)
      vi.mocked(mockPrisma.deposit.findUnique).mockResolvedValue(null)
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValue(member as any)
      vi.mocked(mockPrisma.member.upsert).mockResolvedValue(member as any)
      vi.mocked(mockPrisma.deposit.create).mockResolvedValue({} as any)
      vi.mocked(mockPrisma.depositCode.update).mockResolvedValue({} as any)
      vi.mocked(mockPrisma.member.update).mockResolvedValue({} as any)
      vi.mocked(mockPrisma.group.update).mockResolvedValue({} as any)

      const result = await monitorService.processDeposit(
        'UserDepositAddress123',
        'txSignature123',
        1000000000n,
      )

      expect(result).toBe(true)
      expect(mockPrisma.deposit.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          memberId: 'member-1',
          depositCodeId: null,
          transactionSignature: 'txSignature123',
          amount: 1000000000n,
          detectedAt: expect.any(Date),
        },
      })
    })

    it('should reject expired code', async () => {
      const depositCode = {
        id: 'code-1',
        groupId: 'group-1',
        telegramUserId: '123456789',
        used: false,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60),
      }

      vi.mocked(mockPrisma.depositCode.findUnique).mockResolvedValue(depositCode as any)

      const result = await monitorService.processDeposit(
        'ABC12345',
        'txSignature123',
        1000000000n,
      )

      expect(result).toBe(false)
      expect(mockPrisma.deposit.create).not.toHaveBeenCalled()
    })

    it('should reject already used code', async () => {
      const depositCode = {
        id: 'code-1',
        groupId: 'group-1',
        telegramUserId: '123456789',
        used: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      }

      vi.mocked(mockPrisma.depositCode.findUnique).mockResolvedValue(depositCode as any)

      const result = await monitorService.processDeposit(
        'ABC12345',
        'txSignature123',
        1000000000n,
      )

      expect(result).toBe(false)
      expect(mockPrisma.deposit.create).not.toHaveBeenCalled()
    })

    it('should skip duplicate transaction', async () => {
      const depositCode = {
        id: 'code-1',
        groupId: 'group-1',
        telegramUserId: '123456789',
        used: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      }

      vi.mocked(mockPrisma.depositCode.findUnique).mockResolvedValue(depositCode as any)
      vi.mocked(mockPrisma.deposit.findUnique).mockResolvedValue({ id: 'deposit-1' } as any)

      const result = await monitorService.processDeposit(
        'ABC12345',
        'txSignature123',
        1000000000n,
      )

      expect(result).toBe(false)
      expect(mockPrisma.deposit.create).not.toHaveBeenCalled()
    })
  })
})
