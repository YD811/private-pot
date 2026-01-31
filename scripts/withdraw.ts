/**
 * Withdraw funds from group wallet
 * 
 * Usage: npx tsx scripts/withdraw.ts <destination_address> [amount_in_sol]
 * 
 * If amount is not specified, withdraws all available balance (minus fee)
 */

import { config } from '#root/config.js'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import crypto from 'node:crypto'

// From database
const ENCRYPTED_PRIVATE_KEY = '76a3fa7146e1706fa9f69c9305f2453dfc5c4da31cde2863cb1fb6ab9bc2bb4a202624008b1734482ddb8eed83ce3d608ff9e0420cd268cf4c12290a373d7d83f8236c1d682a45152177388f8d16f9bc'
const ENCRYPTION_IV = '07d2d038c0e3ab47726886909b1a1324'

function decryptPrivateKey(encryptedData: string, ivHex: string): Uint8Array {
  const encryptionKey = Buffer.from(config.walletEncryptionKey, 'hex')
  const iv = Buffer.from(ivHex, 'hex')
  const encryptedBuffer = Buffer.from(encryptedData, 'hex')

  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv)

  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ])

  return new Uint8Array(decrypted)
}

async function main() {
  const destination = process.argv[2]
  const amountSol = process.argv[3] ? parseFloat(process.argv[3]) : undefined

  if (!destination) {
    console.error('Usage: npx tsx scripts/withdraw.ts <destination_address> [amount_in_sol]')
    console.error('Example: npx tsx scripts/withdraw.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.01')
    process.exit(1)
  }

  // Validate destination address
  let destPubkey: PublicKey
  try {
    destPubkey = new PublicKey(destination)
  } catch {
    console.error('Invalid destination address')
    process.exit(1)
  }

  // Decrypt wallet from database
  const secretKey = decryptPrivateKey(ENCRYPTED_PRIVATE_KEY, ENCRYPTION_IV)
  const wallet = Keypair.fromSecretKey(secretKey)

  console.log('Group Wallet:', wallet.publicKey.toBase58())
  console.log('Destination:', destination)

  // Connect to Solana
  const connection = new Connection(config.solanaRpcUrl, 'confirmed')

  // Get balance
  const balance = await connection.getBalance(wallet.publicKey)
  console.log('Current Balance:', balance / LAMPORTS_PER_SOL, 'SOL')

  if (balance === 0) {
    console.log('No funds to withdraw')
    process.exit(0)
  }

  // Calculate amount to send
  const txFee = 5000 // 0.000005 SOL
  
  let lamportsToSend: number
  if (amountSol !== undefined) {
    lamportsToSend = Math.floor(amountSol * LAMPORTS_PER_SOL)
    if (lamportsToSend + txFee > balance) {
      console.error(`Insufficient balance. Max withdrawable: ${(balance - txFee) / LAMPORTS_PER_SOL} SOL`)
      process.exit(1)
    }
  } else {
    // Withdraw all
    lamportsToSend = balance - txFee
    if (lamportsToSend <= 0) {
      console.log('Balance too low to cover transaction fee')
      process.exit(0)
    }
  }

  console.log('Sending:', lamportsToSend / LAMPORTS_PER_SOL, 'SOL')

  // Confirm
  console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to proceed...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Create and send transaction
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: destPubkey,
      lamports: lamportsToSend,
    })
  )

  const { blockhash } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey

  tx.sign(wallet)

  console.log('Sending transaction...')
  const signature = await connection.sendRawTransaction(tx.serialize())
  console.log('Transaction sent:', signature)

  console.log('Confirming...')
  await connection.confirmTransaction(signature, 'confirmed')
  console.log('✅ Withdrawal complete!')
  console.log(`https://solscan.io/tx/${signature}`)
}

main().catch(console.error)
