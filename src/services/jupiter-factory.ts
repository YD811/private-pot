import type { Logger } from '#root/logger.js'
import type { IJupiterService } from './jupiter-interface.js'
import { MockJupiterService } from './jupiter-mock.js'
import { JupiterService } from './jupiter.js'

export function createJupiterService(rpcUrl: string, logger: Logger): IJupiterService {
  // Use mock service for devnet, real service for mainnet
  const isDevnet = rpcUrl.includes('devnet')

  if (isDevnet) {
    logger.warn('⚠️  Using MOCK Jupiter - swaps will be simulated on devnet')
    return new MockJupiterService(rpcUrl, logger)
  }

  return new JupiterService(rpcUrl, logger)
}
