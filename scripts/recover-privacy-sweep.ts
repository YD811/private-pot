/**
 * Recover stuck Privacy Cash sweeps
 *
 * Usage: npx tsx scripts/recover-privacy-sweep.ts [deposit_signature]
 *
 * If deposit_signature is not specified, lists all pending sweeps
 * If specified, attempts to recover that specific sweep
 */

import type { Keypair } from '@solana/web3.js'
import { config } from '#root/config.js'
import { prisma } from '#root/db.js'
import { logger } from '#root/logger.js'
import { PrivacyCashService } from '#root/services/privacy-cash.js'
import { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import { WalletService } from '#root/services/wallet.js'
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'

const scriptLogger = logger.child({ name: 'recover-privacy-sweep' })

async function listPendingSweeps() {
  const sweeps = await prisma.pendingPrivateSweep.findMany({
    where: {
      status: {
        in: ['pending', 'deposited', 'withdrawing'],
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (sweeps.length === 0) {
    console.log('No pending sweeps found')
    return
  }

  console.log('\n📋 Pending Privacy Sweeps:\n')
  for (const sweep of sweeps) {
    console.log(`  ID: ${sweep.id}`)
    console.log(`  Status: ${sweep.status}`)
    console.log(`  Amount: ${Number(sweep.amount) / LAMPORTS_PER_SOL} SOL`)
    console.log(`  Deposit Signature: ${sweep.depositSignature}`)
    console.log(`  Privacy Cash Deposit TX: ${sweep.depositTxSignature || 'N/A'}`)
    console.log(`  Scheduled Withdraw: ${sweep.scheduledWithdrawAt}`)
    console.log(`  Error: ${sweep.errorMessage || 'None'}`)
    console.log(`  Created: ${sweep.createdAt}`)
    console.log('')
  }

  console.log(`Total: ${sweeps.length} pending sweeps\n`)
  console.log('To recover a specific sweep, run:')
  console.log('  npx tsx scripts/recover-privacy-sweep.ts <deposit_signature>\n')
}

async function recoverSweep(depositSignature: string) {
  console.log(`\n🔍 Looking for sweep with deposit signature: ${depositSignature}\n`)

  const sweep = await prisma.pendingPrivateSweep.findUnique({
    where: { depositSignature },
  })

  if (!sweep) {
    console.error('❌ Sweep not found with that deposit signature')
    console.log('\nTrying to find by Privacy Cash deposit TX signature...')

    const sweepByTx = await prisma.pendingPrivateSweep.findFirst({
      where: { depositTxSignature: depositSignature },
    })

    if (!sweepByTx) {
      console.error('❌ Sweep not found')
      return
    }

    console.log('Found sweep by tx signature!')
    return recoverSweepById(sweepByTx.id)
  }

  return recoverSweepById(sweep.id)
}

async function recoverSweepById(sweepId: string) {
  const sweep = await prisma.pendingPrivateSweep.findUnique({
    where: { id: sweepId },
  })

  if (!sweep) {
    console.error('❌ Sweep not found')
    return
  }

  console.log('📦 Sweep Details:')
  console.log(`  ID: ${sweep.id}`)
  console.log(`  Status: ${sweep.status}`)
  console.log(`  Amount: ${Number(sweep.amount) / LAMPORTS_PER_SOL} SOL`)
  console.log(`  Member ID: ${sweep.memberId}`)

  // Get member and group info
  const member = await prisma.member.findUnique({
    where: { id: sweep.memberId },
  })
  const group = await prisma.group.findUnique({
    where: { id: sweep.groupId },
  })

  if (!member || !group) {
    console.error('❌ Member or group not found')
    return
  }

  console.log(`  Group Wallet: ${group.walletAddress}`)

  const rateLimiter = new RPCRateLimiter(scriptLogger)
  const walletService = new WalletService(
    config.walletMasterSeed,
    config.walletEncryptionKey,
    config.solanaRpcUrl,
    rateLimiter,
  )
  const privacyCashService = new PrivacyCashService(scriptLogger)

  // Restore member wallet
  const memberWallet = walletService.restoreWallet(member.encryptedPrivateKey, member.encryptionIv)
  const memberPrivateKeyBase58 = bs58.encode(memberWallet.secretKey)

  console.log(`\n💰 Checking Privacy Cash balance...`)

  const privacyCashConfig = {
    rpcUrl: config.solanaRpcUrl,
    ownerPrivateKey: memberPrivateKeyBase58,
  }

  try {
    const balance = await privacyCashService.getPrivateBalance(privacyCashConfig)
    console.log(`  Private Balance: ${Number(balance) / LAMPORTS_PER_SOL} SOL`)

    if (balance === 0n) {
      console.log('\n⚠️  No private balance found - funds may have already been withdrawn')

      // Check if already completed
      if (sweep.withdraw1TxSignature && sweep.withdraw2TxSignature) {
        console.log('  Withdraw 1 TX:', sweep.withdraw1TxSignature)
        console.log('  Withdraw 2 TX:', sweep.withdraw2TxSignature)
        console.log('\n✅ This sweep appears to be already completed!')
        console.log('  Updating status to "completed"...')

        await prisma.pendingPrivateSweep.update({
          where: { id: sweep.id },
          data: { status: 'completed' },
        })
        return
      }
      return
    }

    console.log(`\n🚀 Proceeding with withdrawal...`)
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n')
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Generate temp wallets
    const { wallet1: tempWallet1, wallet2: tempWallet2 } = privacyCashService.generateTempWallets()
    const { amount1, amount2 } = privacyCashService.calculateSplitAmounts(balance)

    console.log(`\n📤 Withdrawal 1: ${Number(amount1) / LAMPORTS_PER_SOL} SOL -> ${tempWallet1.publicKey.toBase58()}`)

    // Update sweep status
    await prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: {
        status: 'withdrawing',
        tempWallet1Address: tempWallet1.publicKey.toBase58(),
        tempWallet2Address: tempWallet2.publicKey.toBase58(),
        withdraw1Amount: amount1,
        withdraw2Amount: amount2,
      },
    })

    // Perform first withdrawal
    const withdraw1Result = await privacyCashService.withdraw(
      privacyCashConfig,
      amount1,
      tempWallet1.publicKey.toBase58(),
    )
    console.log(`  TX: ${withdraw1Result.signature}`)

    await prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: { withdraw1TxSignature: withdraw1Result.signature },
    })

    console.log('\n⏳ Waiting 3 seconds before second withdrawal...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    console.log(`\n📤 Withdrawal 2: ${Number(amount2) / LAMPORTS_PER_SOL} SOL -> ${tempWallet2.publicKey.toBase58()}`)

    const withdraw2Result = await privacyCashService.withdraw(
      privacyCashConfig,
      amount2,
      tempWallet2.publicKey.toBase58(),
    )
    console.log(`  TX: ${withdraw2Result.signature}`)

    await prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: { withdraw2TxSignature: withdraw2Result.signature },
    })

    console.log('\n⏳ Waiting for withdrawals to confirm...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Transfer from temp wallets to group pot
    const connection = new Connection(config.solanaRpcUrl, 'confirmed')
    const groupPotAddress = group.walletAddress

    console.log(`\n📨 Transferring from temp wallets to group pot: ${groupPotAddress}`)

    await transferFromTempWallet(connection, tempWallet1, groupPotAddress)
    await transferFromTempWallet(connection, tempWallet2, groupPotAddress)

    // Mark as completed
    await prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: { status: 'completed' },
    })

    // Update deposit record
    await prisma.deposit.update({
      where: { transactionSignature: sweep.depositSignature },
      data: { sweptAt: new Date() },
    })

    console.log('\n✅ Privacy sweep recovery completed!')
  }
  catch (error) {
    console.error('\n❌ Error during recovery:', error)

    await prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    })
  }
}

async function transferFromTempWallet(connection: Connection, tempWallet: Keypair, destinationAddress: string) {
  const destinationPubkey = new PublicKey(destinationAddress)

  // Get balance
  const balance = await connection.getBalance(tempWallet.publicKey)
  console.log(`  Temp wallet ${tempWallet.publicKey.toBase58().slice(0, 8)}...: ${balance / LAMPORTS_PER_SOL} SOL`)

  const rentExemption = 890880
  const txFee = 5000
  const transferAmount = BigInt(balance) - BigInt(rentExemption) - BigInt(txFee)

  if (transferAmount <= 0n) {
    console.log(`    ⚠️ Insufficient balance, skipping`)
    return
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: tempWallet.publicKey,
      toPubkey: destinationPubkey,
      lamports: transferAmount,
    }),
  )

  const { blockhash } = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash
  transaction.feePayer = tempWallet.publicKey

  transaction.sign(tempWallet)
  const signature = await connection.sendRawTransaction(transaction.serialize())
  await connection.confirmTransaction(signature, 'confirmed')

  console.log(`    ✅ Transferred ${Number(transferAmount) / LAMPORTS_PER_SOL} SOL`)
  console.log(`    TX: ${signature}`)
}

async function main() {
  const depositSignature = process.argv[2]

  if (!depositSignature) {
    await listPendingSweeps()
  }
  else {
    await recoverSweep(depositSignature)
  }

  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
