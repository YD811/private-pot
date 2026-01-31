import process from 'node:process'
import { API_CONSTANTS } from 'grammy'
import * as v from 'valibot'

const baseConfigSchema = v.object({
  debug: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.boolean()), 'false'),
  logLevel: v.optional(v.pipe(v.string(), v.picklist(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])), 'info'),
  botToken: v.pipe(v.string(), v.regex(/^\d+:[\w-]+$/, 'Invalid token')),
  botAllowedUpdates: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.array(v.picklist(API_CONSTANTS.ALL_UPDATE_TYPES))), '[]'),
  botAdmins: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.array(v.number())), '[]'),
  databaseUrl: v.pipe(v.string(), v.url()),
  walletMasterSeed: v.pipe(v.string(), v.minLength(12), v.description('Seed phrase or private key')),
  walletEncryptionKey: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i, 'Must be 64-character hex string')),
  solanaRpcUrl: v.optional(v.pipe(v.string(), v.url()), 'https://api.devnet.solana.com'),
  // Comma-separated list of RPC URLs for read-only operations (background jobs)
  // If multiple URLs provided, they will be rotated on rate limits
  solanaRpcUrlReadOnly: v.optional(v.string(), undefined),
  // Operator fee wallet address - fees from trades will be sent to this address
  operatorFeeWalletAddress: v.optional(v.pipe(v.string(), v.minLength(32)), undefined),
  // Privacy Cash integration - enables private sweeps via Privacy Cash with split withdrawals
  privacyCashEnabled: v.optional(v.pipe(v.string(), v.transform(JSON.parse), v.boolean()), 'false'),
})

const configSchema = v.variant('botMode', [
  // polling config
  v.pipe(
    v.object({
      botMode: v.literal('polling'),
      ...baseConfigSchema.entries,
    }),
    v.transform(input => ({
      ...input,
      isDebug: input.debug,
      isWebhookMode: false as const,
      isPollingMode: true as const,
    })),
  ),
  // webhook config
  v.pipe(
    v.object({
      botMode: v.literal('webhook'),
      ...baseConfigSchema.entries,
      botWebhook: v.pipe(v.string(), v.url()),
      botWebhookSecret: v.pipe(v.string(), v.minLength(12)),
      serverHost: v.optional(v.string(), '0.0.0.0'),
      serverPort: v.optional(v.pipe(v.string(), v.transform(Number), v.number()), '80'),
    }),
    v.transform(input => ({
      ...input,
      isDebug: input.debug,
      isWebhookMode: true as const,
      isPollingMode: false as const,
    })),
  ),
])

export type Config = v.InferOutput<typeof configSchema>
export type PollingConfig = v.InferOutput<typeof configSchema['options'][0]>
export type WebhookConfig = v.InferOutput<typeof configSchema['options'][1]>

export function createConfig(input: v.InferInput<typeof configSchema>) {
  return v.parse(configSchema, input)
}

export const config = createConfigFromEnvironment()

function createConfigFromEnvironment() {
  type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
    ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
    : Lowercase<S>

  type KeysToCamelCase<T> = {
    [K in keyof T as CamelCase<string & K>]: T[K] extends object ? KeysToCamelCase<T[K]> : T[K]
  }

  function toCamelCase(str: string): string {
    return str.toLowerCase().replace(/_([a-z])/g, (_match, p1) => p1.toUpperCase())
  }

  function convertKeysToCamelCase<T>(obj: T): KeysToCamelCase<T> {
    const result: any = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const camelCaseKey = toCamelCase(key)
        result[camelCaseKey] = obj[key]
      }
    }
    return result
  }

  try {
    process.loadEnvFile()
  }
  catch {
    // No .env file found
  }

  try {
    // @ts-expect-error create config from environment variables
    const config = createConfig(convertKeysToCamelCase(process.env))

    return config
  }
  catch (error) {
    throw new Error('Invalid config', {
      cause: error,
    })
  }
}
