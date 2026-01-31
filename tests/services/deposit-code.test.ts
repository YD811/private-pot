import { DepositCodeService } from '#root/services/deposit-code.js'
import { describe, expect, it } from 'vitest'

describe('depositCodeService', () => {
  describe('generateCode', () => {
    it('should generate 8-character alphanumeric code', () => {
      const service = new DepositCodeService()
      const code = service.generateCode()

      expect(code).toMatch(/^[A-Z0-9]{8}$/)
      expect(code.length).toBe(8)
    })

    it('should generate unique codes', () => {
      const service = new DepositCodeService()
      const codes = new Set<string>()

      for (let i = 0; i < 100; i++) {
        codes.add(service.generateCode())
      }

      expect(codes.size).toBe(100)
    })

    it('should exclude ambiguous characters', () => {
      const service = new DepositCodeService()
      const ambiguousChars = ['0', 'O', 'I', '1', 'L']

      for (let i = 0; i < 50; i++) {
        const code = service.generateCode()
        for (const char of ambiguousChars) {
          expect(code).not.toContain(char)
        }
      }
    })
  })

  describe('getExpirationDate', () => {
    it('should return date 24 hours from now by default', () => {
      const service = new DepositCodeService()
      const now = new Date()
      const expiration = service.getExpirationDate()

      const expectedTime = now.getTime() + 24 * 60 * 60 * 1000
      const timeDiff = Math.abs(expiration.getTime() - expectedTime)

      expect(timeDiff).toBeLessThan(1000)
    })

    it('should accept custom hours', () => {
      const service = new DepositCodeService()
      const now = new Date()
      const expiration = service.getExpirationDate(48)

      const expectedTime = now.getTime() + 48 * 60 * 60 * 1000
      const timeDiff = Math.abs(expiration.getTime() - expectedTime)

      expect(timeDiff).toBeLessThan(1000)
    })
  })

  describe('isCodeExpired', () => {
    it('should return false for future date', () => {
      const service = new DepositCodeService()
      const futureDate = new Date(Date.now() + 1000 * 60 * 60)

      expect(service.isCodeExpired(futureDate)).toBe(false)
    })

    it('should return true for past date', () => {
      const service = new DepositCodeService()
      const pastDate = new Date(Date.now() - 1000 * 60 * 60)

      expect(service.isCodeExpired(pastDate)).toBe(true)
    })

    it('should return true for current time', () => {
      const service = new DepositCodeService()
      const now = new Date()

      expect(service.isCodeExpired(now)).toBe(true)
    })
  })

  describe('formatDepositInstructions', () => {
    it('should format complete deposit instructions', () => {
      const service = new DepositCodeService()
      const instructions = service.formatDepositInstructions(
        'ABC123XY',
        'So11111111111111111111111111111111111111112',
      )

      expect(instructions).toContain('ABC123XY')
      expect(instructions).toContain('So11111111111111111111111111111111111111112')
      expect(instructions.toLowerCase()).toContain('memo')
      expect(instructions).toContain('24')
    })

    it('should include wallet address and code prominently', () => {
      const service = new DepositCodeService()
      const code = 'TEST1234'
      const address = 'TestAddress123'
      const instructions = service.formatDepositInstructions(code, address)

      const codeIndex = instructions.indexOf(code)
      const addressIndex = instructions.indexOf(address)

      expect(codeIndex).toBeGreaterThan(-1)
      expect(addressIndex).toBeGreaterThan(-1)
    })
  })
})
