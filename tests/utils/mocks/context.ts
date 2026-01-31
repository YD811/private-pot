import type { Context } from '#root/bot/context.js'
import { vi } from 'vitest'

interface MockContextOptions {
  chatType?: 'private' | 'group' | 'supergroup' | 'channel'
  chatId?: number
  userId?: number
  username?: string
  messageText?: string
  command?: string
  match?: string
}

/**
 * Create a mock Telegram context for testing
 *
 * @example
 * ```typescript
 * const ctx = createMockContext({ chatType: 'private' })
 * ctx.from = { id: 123, first_name: 'John' }
 * await myHandler(ctx)
 * expect(ctx.reply).toHaveBeenCalled()
 * ```
 */
export function createMockContext(
  options: MockContextOptions = {},
): Context {
  const {
    chatType = 'group',
    chatId = chatType === 'private' ? 123 : -1001234567890,
    userId = 123,
    username = 'testuser',
    messageText,
    command,
    match,
    ...overrides
  } = options

  const chatData = chatType === 'private'
    ? {
        id: chatId,
        type: 'private' as const,
        first_name: 'Test',
        username,
      }
    : {
        id: chatId,
        type: chatType as 'group' | 'supergroup' | 'channel',
        title: 'Test Group',
      }
  const messageData = command
    ? {
        message_id: 1,
        date: Date.now() / 1000,
        chat: chatData,
        text: `/${command}`,
        entities: [{ type: 'bot_command', offset: 0, length: command.split(' ')[0].length + 1 }],
        from: {
          id: userId,
          is_bot: false,
          first_name: 'Test',
          username,
          language_code: 'en',
        },
      }
    : messageText
      ? {
          message_id: 1,
          date: Date.now() / 1000,
          chat: chatData,
          text: messageText,
          from: {
            id: userId,
            is_bot: false,
            first_name: 'Test',
            username,
            language_code: 'en',
          },
        }
      : {
          message_id: 1,
          date: Date.now() / 1000,
          chat: chatData,
          from: {
            id: userId,
            is_bot: false,
            first_name: 'Test',
            username,
            language_code: 'en',
          },
        }

  const ctx = {
    // Bot API
    api: {
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
      setMyCommands: vi.fn(),
      getMe: vi.fn(),
      getChat: vi.fn(),
    },

    // Update data
    update: {
      update_id: 1,
      message: messageData,
    },

    // Message data
    message: messageData,
    msg: messageData!,

    // Chat data
    chat: chatData,

    // User data
    from: {
      id: userId,
      is_bot: false,
      first_name: 'Test',
      username,
      language_code: 'en',
    },

    // Command match data
    match: match !== undefined ? match : (command ? command.split(' ').slice(1).join(' ') : undefined),

    // Methods
    reply: vi.fn(),
    replyWithHTML: vi.fn(),
    replyWithMarkdown: vi.fn(),
    editMessageText: vi.fn(),
    answerCallbackQuery: vi.fn(),
    deleteMessage: vi.fn(),

    // i18n
    t: vi.fn((key: string) => key),
    i18n: {
      locale: vi.fn(() => 'en'),
      setLocale: vi.fn(),
    },

    // Session (add session structure as needed)
    session: {},

    // Callback query (for callback button tests)
    callbackQuery: undefined,

    // Commands
    commands: [],

    // Additional methods
    getChatAdministrators: vi.fn().mockResolvedValue([]),

    ...overrides,
  } as unknown as Context

  return ctx
}

/**
 * Create a mock context for callback queries
 */
export function createMockCallbackContext(
  data: string,
  overrides: Partial<Context> = {},
): Context {
  const { match, ...rest } = overrides
  return createMockContext({
    callbackQuery: {
      id: 'callback-1',
      from: {
        id: 123,
        is_bot: false,
        first_name: 'Test',
      },
      chat_instance: 'instance-1',
      data,
    } as any,
    match: typeof match === 'string' ? match : undefined,
    ...rest,
  } as MockContextOptions)
}

/**
 * Create a mock context for group chats
 */
export function createMockGroupContext(options: MockContextOptions = {}): Context {
  return createMockContext({
    chatType: 'supergroup',
    chatId: -1001234567890,
    ...options,
  })
}

/**
 * Create a mock context for private chats
 */
export function createMockPrivateContext(overrides: Partial<Context> = {}): Context {
  const { match, ...rest } = overrides
  return createMockContext({
    chat: {
      id: 123,
      type: 'private' as const,
      first_name: 'Test',
      username: 'testuser',
    },
    match: typeof match === 'string' ? match : undefined,
    ...rest,
  } as MockContextOptions)
}
