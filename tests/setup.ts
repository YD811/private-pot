/**
 * Test setup file
 * Runs before all tests
 */

import process from 'node:process'
import { afterAll, afterEach, beforeAll } from 'vitest'

// Global test setup
beforeAll(() => {
  // Setup that runs once before all tests
  // e.g., initialize test database, mock services, etc.
})

// Cleanup after each test
afterEach(() => {
  // Reset mocks, clear test data, etc.
})

// Global test teardown
afterAll(() => {
  // Cleanup that runs once after all tests
  // e.g., close database connections, cleanup resources
})

// Mock environment variables for tests
process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz-0123456789'
process.env.BOT_MODE = 'polling'
process.env.LOG_LEVEL = 'silent'
process.env.DEBUG = 'false'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.WALLET_MASTER_SEED = 'test seed phrase for wallet generation in tests'
process.env.WALLET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.PRIVACY_CASH_ENABLED = 'false'