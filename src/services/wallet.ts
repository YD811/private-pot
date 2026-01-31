import type { RPCRateLimiter } from './rpc-rate-limiter.js'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import * as bip39 from 'bip39'
import bs58 from 'bs58'
import { derivePath } from 'ed25519-hd-key'

export interface EncryptedPrivateKey {
  encryptedData: string
  iv: string
}

export interface GroupWalletData {
  publicKey: string
  encryptedPrivateKey: string
  iv: string
}

export interface UserDepositWalletData {
  publicKey: string
  encryptedPrivateKey: string
  iv: string
}

export class WalletService {
  private readonly masterKeypair?: Keypair
  private readonly masterSeed?: Buffer
  private readonly encryptionKey: Buffer
  private readonly usePrivateKey: boolean
  private readonly connection: Connection

  constructor(
    seedOrPrivateKey: string,
    encryptionKeyHex: string,
    rpcUrl: string,
    private readonly rateLimiter: RPCRateLimiter,
  ) {
    this.encryptionKey = Buffer.from(encryptionKeyHex, 'hex')
    // Create connection with custom fetch that uses the singleton rate limiter
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      fetch: async (url, options) => {
        // Check circuit breaker before making request
        if (rateLimiter.isCircuitBreakerOpen()) {
          const error: any = new Error(
            `Circuit breaker open: ${rateLimiter.getConsecutiveErrors()} consecutive rate limit errors. `
            + 'RPC requests are temporarily disabled to prevent system overload.',
          )
          error.status = 503 // Service Unavailable
          error.circuitBreakerOpen = true
          throw error
        }

        await rateLimiter.waitForRateLimit()

        const response = await fetch(url, options)

        // If we get a 429, throw an error with the response so we can read Retry-After
        if (response.status === 429) {
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

        return response
      },
    })

    if (this.isPrivateKey(seedOrPrivateKey)) {
      this.usePrivateKey = true
      this.masterKeypair = this.keypairFromPrivateKey(seedOrPrivateKey)
    }
    else {
      this.usePrivateKey = false
      this.masterSeed = bip39.mnemonicToSeedSync(seedOrPrivateKey)
    }
  }

  private isPrivateKey(input: string): boolean {
    const trimmed = input.trim()

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return true
    }

    if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed)) {
      return true
    }

    if (/^[0-9a-f]{128}$/i.test(trimmed)) {
      return true
    }

    return false
  }

  private keypairFromPrivateKey(privateKey: string): Keypair {
    const trimmed = privateKey.trim()

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const bytes = JSON.parse(trimmed)
      return Keypair.fromSecretKey(Uint8Array.from(bytes))
    }

    if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed)) {
      const decoded = bs58.decode(trimmed)
      return Keypair.fromSecretKey(decoded)
    }

    if (/^[0-9a-f]{128}$/i.test(trimmed)) {
      const bytes = Buffer.from(trimmed, 'hex')
      return Keypair.fromSecretKey(bytes)
    }

    throw new Error('Invalid private key format')
  }

  deriveGroupWallet(groupId: string): Keypair {
    if (this.usePrivateKey && this.masterKeypair) {
      const hash = crypto.createHash('sha256')
        .update(this.masterKeypair.secretKey)
        .update(groupId)
        .digest()

      const seed = hash.slice(0, 32)
      return Keypair.fromSeed(seed)
    }

    if (!this.masterSeed) {
      throw new Error('Master seed not initialized')
    }

    const hash = crypto.createHash('sha256').update(groupId).digest()
    const accountIndex = hash.readUInt32BE(0) % 0x80000000

    const derivationPath = `m/44'/501'/${accountIndex}'/0'`
    const derived = derivePath(derivationPath, this.masterSeed.toString('hex'))

    return Keypair.fromSeed(derived.key)
  }

  deriveUserDepositWallet(groupId: string, userId: string): Keypair {
    if (this.usePrivateKey && this.masterKeypair) {
      const hash = crypto.createHash('sha256')
        .update(this.masterKeypair.secretKey)
        .update(groupId)
        .update(userId)
        .digest()

      const seed = hash.slice(0, 32)
      return Keypair.fromSeed(seed)
    }

    if (!this.masterSeed) {
      throw new Error('Master seed not initialized')
    }

    const combinedId = `${groupId}:${userId}`
    const hash = crypto.createHash('sha256').update(combinedId).digest()
    const accountIndex = hash.readUInt32BE(0) % 0x80000000

    const derivationPath = `m/44'/501'/${accountIndex}'/1'`
    const derived = derivePath(derivationPath, this.masterSeed.toString('hex'))

    return Keypair.fromSeed(derived.key)
  }

  encryptPrivateKey(privateKey: Uint8Array): EncryptedPrivateKey {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv)

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKey)),
      cipher.final(),
    ])

    return {
      encryptedData: encrypted.toString('hex'),
      iv: iv.toString('hex'),
    }
  }

  decryptPrivateKey(encryptedData: string, ivHex: string): Uint8Array {
    const iv = Buffer.from(ivHex, 'hex')
    const encryptedBuffer = Buffer.from(encryptedData, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv)

    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final(),
    ])

    return new Uint8Array(decrypted)
  }

  createGroupWallet(groupId: string): GroupWalletData {
    const keypair = this.deriveGroupWallet(groupId)
    const encrypted = this.encryptPrivateKey(keypair.secretKey)

    return {
      publicKey: keypair.publicKey.toBase58(),
      encryptedPrivateKey: encrypted.encryptedData,
      iv: encrypted.iv,
    }
  }

  createUserDepositWallet(groupId: string, userId: string): UserDepositWalletData {
    const keypair = this.deriveUserDepositWallet(groupId, userId)
    const encrypted = this.encryptPrivateKey(keypair.secretKey)

    return {
      publicKey: keypair.publicKey.toBase58(),
      encryptedPrivateKey: encrypted.encryptedData,
      iv: encrypted.iv,
    }
  }

  restoreWallet(encryptedPrivateKey: string, iv: string): Keypair {
    const decryptedKey = this.decryptPrivateKey(encryptedPrivateKey, iv)
    return Keypair.fromSecretKey(decryptedKey)
  }

  async getBalance(walletAddress: string): Promise<bigint> {
    return this.rateLimiter.executeWithRetry(async () => {
      const publicKey = new PublicKey(walletAddress)
      const balance = await this.connection.getBalance(publicKey)
      return BigInt(balance)
    }, 'getBalance')
  }
}
