import type { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import { Buffer } from 'node:buffer'
import { WalletService } from '#root/services/wallet.js'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
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

describe('walletService with private key', () => {
  const encryptionKey = 'a'.repeat(64)
  const testKeypair = Keypair.generate()
  const mockRateLimiter = createMockRateLimiter()

  describe('private key formats', () => {
    it('should accept base58 private key', () => {
      const base58Key = bs58.encode(testKeypair.secretKey)
      const service = new WalletService(base58Key, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet = service.deriveGroupWallet('test-group')
      expect(wallet.publicKey).toBeDefined()
    })

    it('should accept byte array private key', () => {
      const byteArray = `[${Array.from(testKeypair.secretKey).join(',')}]`
      const service = new WalletService(byteArray, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet = service.deriveGroupWallet('test-group')
      expect(wallet.publicKey).toBeDefined()
    })

    it('should accept hex private key', () => {
      const hexKey = Buffer.from(testKeypair.secretKey).toString('hex')
      const service = new WalletService(hexKey, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet = service.deriveGroupWallet('test-group')
      expect(wallet.publicKey).toBeDefined()
    })

    it('should still accept seed phrase', () => {
      const seedPhrase = 'test seed phrase with twelve words that makes sense here please'
      const service = new WalletService(seedPhrase, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet = service.deriveGroupWallet('test-group')
      expect(wallet.publicKey).toBeDefined()
    })
  })

  describe('deterministic derivation with private key', () => {
    it('should derive same wallet for same group with private key', () => {
      const base58Key = bs58.encode(testKeypair.secretKey)
      const service = new WalletService(base58Key, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet1 = service.deriveGroupWallet('group-123')
      const wallet2 = service.deriveGroupWallet('group-123')

      expect(wallet1.publicKey.toBase58()).toBe(wallet2.publicKey.toBase58())
    })

    it('should derive different wallets for different groups with private key', () => {
      const base58Key = bs58.encode(testKeypair.secretKey)
      const service = new WalletService(base58Key, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet1 = service.deriveGroupWallet('group-123')
      const wallet2 = service.deriveGroupWallet('group-456')

      expect(wallet1.publicKey.toBase58()).not.toBe(wallet2.publicKey.toBase58())
    })
  })

  describe('encryption works with private key', () => {
    it('should encrypt and decrypt private key derived from master key', () => {
      const base58Key = bs58.encode(testKeypair.secretKey)
      const service = new WalletService(base58Key, encryptionKey, 'https://api.mainnet-beta.solana.com', mockRateLimiter)

      const wallet = service.deriveGroupWallet('test-group')
      const encrypted = service.encryptPrivateKey(wallet.secretKey)
      const decrypted = service.decryptPrivateKey(encrypted.encryptedData, encrypted.iv)

      expect(Buffer.from(decrypted)).toEqual(Buffer.from(wallet.secretKey))
    })
  })
})
