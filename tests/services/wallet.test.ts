import type { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import { Buffer } from 'node:buffer'
import { WalletService } from '#root/services/wallet.js'
import { describe, expect, it, vi } from 'vitest'

function createMockRateLimiter(): RPCRateLimiter {
  return {
    waitForRateLimit: vi.fn().mockResolvedValue(undefined),
    executeWithRetry: vi.fn().mockImplementation(async fn => fn()),
    shouldSkip: vi.fn().mockReturnValue(false),
    resetErrors: vi.fn(),
    getConsecutiveErrors: vi.fn().mockReturnValue(0),
  } as any
}

describe('walletService', () => {
  const masterSeed = 'test seed phrase with twelve words that makes sense here please'
  const encryptionKey = 'a'.repeat(64)
  const mockRateLimiter = createMockRateLimiter()

  describe('deriveGroupWallet', () => {
    it('should derive deterministic wallet from group ID', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet1 = service.deriveGroupWallet('group-123')
      const wallet2 = service.deriveGroupWallet('group-123')

      expect(wallet1.publicKey.toBase58()).toBe(wallet2.publicKey.toBase58())
      expect(wallet1.secretKey).toEqual(wallet2.secretKey)
    })

    it('should derive different wallets for different groups', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet1 = service.deriveGroupWallet('group-123')
      const wallet2 = service.deriveGroupWallet('group-456')

      expect(wallet1.publicKey.toBase58()).not.toBe(wallet2.publicKey.toBase58())
    })

    it('should return valid Solana keypair', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet = service.deriveGroupWallet('test-group')

      expect(wallet.publicKey).toBeDefined()
      expect(wallet.secretKey).toBeDefined()
      expect(wallet.secretKey.length).toBe(64)
    })
  })

  describe('encryptPrivateKey', () => {
    it('should encrypt and decrypt private key', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet = service.deriveGroupWallet('test-group')

      const encrypted = service.encryptPrivateKey(wallet.secretKey)

      expect(encrypted.encryptedData).toBeDefined()
      expect(encrypted.iv).toBeDefined()
      expect(encrypted.encryptedData).not.toBe(wallet.secretKey.toString())
    })

    it('should produce different ciphertext with different IVs', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet = service.deriveGroupWallet('test-group')

      const encrypted1 = service.encryptPrivateKey(wallet.secretKey)
      const encrypted2 = service.encryptPrivateKey(wallet.secretKey)

      expect(encrypted1.encryptedData).not.toBe(encrypted2.encryptedData)
      expect(encrypted1.iv).not.toBe(encrypted2.iv)
    })
  })

  describe('decryptPrivateKey', () => {
    it('should successfully decrypt encrypted private key', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet = service.deriveGroupWallet('test-group')

      const encrypted = service.encryptPrivateKey(wallet.secretKey)
      const decrypted = service.decryptPrivateKey(encrypted.encryptedData, encrypted.iv)

      expect(Buffer.from(decrypted)).toEqual(Buffer.from(wallet.secretKey))
    })

    it('should produce different output with wrong IV', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet = service.deriveGroupWallet('test-group')

      const encrypted = service.encryptPrivateKey(wallet.secretKey)
      const wrongIv = Buffer.from('b'.repeat(32), 'hex').toString('hex')

      const decrypted = service.decryptPrivateKey(encrypted.encryptedData, wrongIv)
      expect(Buffer.from(decrypted)).not.toEqual(Buffer.from(wallet.secretKey))
    })

    it('should fail with wrong encryption key', () => {
      const service1 = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const service2 = new WalletService(masterSeed, 'b'.repeat(64), 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const wallet = service1.deriveGroupWallet('test-group')

      const encrypted = service1.encryptPrivateKey(wallet.secretKey)

      expect(() => service2.decryptPrivateKey(encrypted.encryptedData, encrypted.iv)).toThrow()
    })
  })

  describe('createGroupWallet', () => {
    it('should create wallet with encrypted private key', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const walletData = service.createGroupWallet('group-789')

      expect(walletData.publicKey).toBeDefined()
      expect(walletData.encryptedPrivateKey).toBeDefined()
      expect(walletData.iv).toBeDefined()
      expect(walletData.publicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    })

    it('should be able to restore wallet from encrypted data', () => {
      const service = new WalletService(masterSeed, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)
      const walletData = service.createGroupWallet('group-789')

      const decrypted = service.decryptPrivateKey(walletData.encryptedPrivateKey, walletData.iv)
      const restoredWallet = service.deriveGroupWallet('group-789')

      expect(Buffer.from(decrypted)).toEqual(Buffer.from(restoredWallet.secretKey))
    })
  })
})
