import { customAlphabet } from 'nanoid'

export class DepositCodeService {
  private readonly alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  private readonly codeLength = 8

  generateCode(): string {
    const nanoid = customAlphabet(this.alphabet, this.codeLength)
    return nanoid()
  }

  getExpirationDate(hoursFromNow: number = 24): Date {
    return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  }

  isCodeExpired(expirationDate: Date): boolean {
    return expirationDate.getTime() <= Date.now()
  }

  formatDepositInstructions(code: string, walletAddress: string): string {
    return `💰 <b>Deposit Instructions</b>

<b>Wallet Address:</b>
<code>${walletAddress}</code>

<b>Your Deposit Code:</b>
<code>${code}</code>

<b>How to deposit:</b>
1. Send SOL to the wallet address above
2. Include your deposit code in the memo field
3. Your deposit will be credited within seconds

⏰ This code expires in 24 hours
⚠️ Make sure to include the code in the memo field, or your deposit won't be credited!`
  }
}
