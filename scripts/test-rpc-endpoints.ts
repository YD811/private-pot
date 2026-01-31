#!/usr/bin/env tsx
/**
 * Test script to find and test free Solana RPC endpoints
 * Usage: tsx scripts/test-rpc-endpoints.ts
 */

import process from 'node:process'
import { Connection, PublicKey } from '@solana/web3.js'

// List of free/public Solana RPC endpoints to test
const RPC_ENDPOINTS = [
  // Official Solana endpoints (rate limited but free)
  'https://api.mainnet-beta.solana.com',
  'https://api.devnet.solana.com',

  // PublicNode (free, no API key required)
  'https://solana-rpc.publicnode.com',

  // Pocket Network (free, no API key required)
  'https://solana.api.pocket.network',

  // Note: The following require API keys but have free tiers:
  // - Helius: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
  // - QuickNode: https://YOUR_ENDPOINT.solana-mainnet.quiknode.pro/YOUR_KEY/
  // - Triton: https://YOUR_ENDPOINT.rpcpool.com/YOUR_KEY
  // - Ankr: https://rpc.ankr.com/solana (requires API key)
]

interface TestResult {
  url: string
  success: boolean
  latency?: number
  error?: string
  blockHeight?: number
  slot?: number
}

async function testRpcEndpoint(url: string, timeout = 5000): Promise<TestResult> {
  const startTime = Date.now()

  try {
    const connection = new Connection(url, {
      commitment: 'confirmed',
      httpHeaders: {
        'Content-Type': 'application/json',
      },
    })

    // Test 1: Get latest block height
    const blockHeight = await Promise.race([
      connection.getBlockHeight(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout),
      ),
    ])

    // Test 2: Get slot
    const slot = await Promise.race([
      connection.getSlot(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout),
      ),
    ])

    // Test 3: Get balance of a known address (System Program)
    const systemProgram = new PublicKey('11111111111111111111111111111111')
    await Promise.race([
      connection.getBalance(systemProgram),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout),
      ),
    ])

    const latency = Date.now() - startTime

    return {
      url,
      success: true,
      latency,
      blockHeight,
      slot,
    }
  }
  catch (error: any) {
    const latency = Date.now() - startTime
    return {
      url,
      success: false,
      latency,
      error: error.message || String(error),
    }
  }
}

async function main() {
  console.log('🔍 Testing Solana RPC Endpoints...\n')
  console.log(`Testing ${RPC_ENDPOINTS.length} endpoints...\n`)

  const results: TestResult[] = []

  for (const endpoint of RPC_ENDPOINTS) {
    process.stdout.write(`Testing ${endpoint}... `)
    const result = await testRpcEndpoint(endpoint)
    results.push(result)

    if (result.success) {
      console.log(`✅ OK (${result.latency}ms) - Block: ${result.blockHeight}, Slot: ${result.slot}`)
    }
    else {
      console.log(`❌ FAILED - ${result.error}`)
    }
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log('\n📊 Summary:\n')

  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log(`✅ Working: ${successful.length}/${results.length}`)
  console.log(`❌ Failed: ${failed.length}/${results.length}\n`)

  if (successful.length > 0) {
    console.log('✅ Working Endpoints:')
    successful
      .sort((a, b) => (a.latency || 0) - (b.latency || 0))
      .forEach((result) => {
        console.log(`  • ${result.url}`)
        console.log(`    Latency: ${result.latency}ms | Block: ${result.blockHeight} | Slot: ${result.slot}`)
      })
    console.log()
  }

  if (failed.length > 0) {
    console.log('❌ Failed Endpoints:')
    failed.forEach((result) => {
      console.log(`  • ${result.url}`)
      console.log(`    Error: ${result.error}`)
    })
    console.log()
  }

  // Recommend best endpoints
  if (successful.length > 0) {
    const sorted = successful.sort((a, b) => (a.latency || 0) - (b.latency || 0))
    const top3 = sorted.slice(0, 3)

    console.log('💡 Recommended Endpoints (fastest first):')
    top3.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.url} (${result.latency}ms)`)
    })
    console.log()

    console.log('📝 For SOLANA_RPC_URL_READ_ONLY, use:')
    console.log(`   ${top3.map(r => r.url).join(',')}`)
  }
}

main().catch(console.error)
