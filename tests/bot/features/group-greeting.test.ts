import { groupGreetingFeature } from '#root/bot/features/group-greeting.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

describe('groupGreetingFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('new_chat_members handler', () => {
    it('sends greeting when bot is added to group', async () => {
      const ctx = createMockContext({
        chatType: 'group',
      })

      // Mock new_chat_members with bot
      ;(ctx.message as any).new_chat_members = [
        {
          id: 123456789, // Bot ID
          is_bot: true,
          username: 'testbot',
        },
      ]
      ;(ctx as any).me = { id: 123456789, username: 'testbot' }
      ctx.reply = vi.fn()

      await groupGreetingFeature().middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Hello everyone! I\'m Pot Bot!'),
        { parse_mode: 'HTML' },
      )
    })

    it('does not send greeting when other members are added', async () => {
      const ctx = createMockContext({
        chatType: 'group',
      })

      // Mock new_chat_members without bot
      ;(ctx.message as any).new_chat_members = [
        {
          id: 999999999,
          is_bot: false,
          username: 'otheruser',
        },
      ]
      ;(ctx as any).me = { id: 123456789, username: 'testbot' }
      ctx.reply = vi.fn()

      await groupGreetingFeature().middleware()(ctx, vi.fn())

      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('does not send greeting in private chat', async () => {
      const ctx = createMockContext({
        chatType: 'private',
      })

      ;(ctx.message as any).new_chat_members = [
        {
          id: 123456789,
          is_bot: true,
          username: 'testbot',
        },
      ]
      ;(ctx as any).me = { id: 123456789, username: 'testbot' }
      ctx.reply = vi.fn()

      await groupGreetingFeature().middleware()(ctx, vi.fn())

      expect(ctx.reply).not.toHaveBeenCalled()
    })
  })
})
