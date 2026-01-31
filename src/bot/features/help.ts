import type { Context } from '#root/bot/context.js'
import { Composer } from 'grammy'

export const helpFeature = new Composer<Context>()

const feature = helpFeature.chatType('private')

feature.command('help', async (ctx) => {
  const helpMessage = `📖 <b>How Pot Bot Works:</b>

🔹 <b>ONE GROUP, ONE POT</b>

Every member deposits SOL into a shared wallet. Your ownership is tracked automatically based on your contribution.

🔹 <b>DEPOSIT & AUTO-SWEEP</b>

Each member gets a unique deposit address. When you send SOL, it's automatically swept into the main group pot.

🔹 <b>TRACK OWNERSHIP</b>

Your ownership percentage is calculated in real-time based on your deposits and the current pot value.

🔹 <b>TRADE TOGETHER</b>

Designated traders can buy and sell tokens using the group's pooled funds.

🔹 <b>PROFIT PROPORTIONALLY</b>

Everyone owns their share of the pot's gains (or losses). When you withdraw, you get your percentage of the total value.

🔹 <b>TRANSPARENT & FAIR</b>

All transactions are recorded on Solana blockchain. View your portfolio and trade history anytime.

🔹 <b>PERFORMANCE TRACKING</b>

Your group's PnL (Profit & Loss) is calculated daily and displayed on the global leaderboard. Track your group's performance over time!

<b>💰 Fees:</b>

• 0.5% trading fee on all buy/sell transactions
• No deposit or withdrawal fees

<b>🔒 Security:</b>

• 24-hour withdrawal queue for safety
• All transactions verifiable on Solana
• Encrypted wallet storage

<b>📋 Available Commands:</b>

<b>💰 For Members:</b>
/deposit - Get your unique deposit address
/balance - Check your balance and ownership %
/withdraw - Withdraw your funds (24h queue)
/portfolio - View group holdings with PnL
/history - See all trade history
/members - List all group members
/limits - View trading limits

<b>📈 For Traders:</b>
/buy &lt;token&gt; &lt;amount&gt; - Buy tokens with group funds
/sell &lt;token&gt; &lt;amount&gt; - Sell tokens for SOL

<b>👥 For Admins:</b>
/add_trader @username - Grant trading permission
/remove_trader @username - Revoke trading permission
/set_limit @username &lt;amount&gt; - Set trade limits
/pause - Pause all trading
/unpause - Resume trading
/privacy - Toggle leaderboard visibility

<b>ℹ️ Other:</b>
/start - Initialize group or view leaderboard
/leaderboard - View global trading leaderboard
/help - Show this help message

Ready to start? Add the bot to your group and type /start!`

  await ctx.reply(helpMessage, {
    parse_mode: 'HTML',
    reply_parameters: { message_id: ctx.msg.message_id },
  })
})

// Also handle help in groups
helpFeature.chatType(['group', 'supergroup']).command('help', async (ctx) => {
  const helpMessage = `📖 <b>How Pot Bot Works:</b>

🔹 <b>ONE GROUP, ONE POT</b>
Every member deposits SOL into a shared wallet. Your ownership is tracked automatically.

🔹 <b>DEPOSIT & AUTO-SWEEP</b>
Each member gets a unique deposit address. When you send SOL, it's automatically swept into the main group pot.

🔹 <b>TRACK OWNERSHIP</b>
Your ownership percentage is calculated in real-time based on your deposits and the current pot value.

🔹 <b>TRADE TOGETHER</b>
Designated traders can buy and sell tokens using the group's pooled funds.

🔹 <b>PROFIT PROPORTIONALLY</b>
Everyone owns their share of the pot's gains (or losses). When you withdraw, you get your percentage of the total value.

🔹 <b>TRANSPARENT & FAIR</b>
All transactions are recorded on Solana blockchain. View your portfolio and trade history anytime.

🔹 <b>PERFORMANCE TRACKING</b>
Your group's PnL is calculated daily. Top-performing groups appear on the global leaderboard!

<b>💰 Fees:</b>
• 0.5% trading fee on all buy/sell transactions
• No deposit or withdrawal fees

<b>🔒 Security:</b>
• 24-hour withdrawal queue for safety
• All transactions verifiable on Solana
• Encrypted wallet storage

<b>📋 Commands:</b>

<b>💰 Members:</b>
• /deposit - Get your deposit address
• /balance - Check balance & ownership %
• /withdraw - Withdraw funds
• /portfolio - View holdings with PnL
• /history - See trade history
• /members - List all members
• /limits - View trading limits

<b>📈 Traders:</b>
• /buy &lt;token&gt; &lt;amount&gt; - Buy tokens
• /sell &lt;token&gt; &lt;amount&gt; - Sell tokens

<b>👥 Admins:</b>
• /add_trader @username - Grant trading
• /remove_trader @username - Revoke trading
• /set_limit @username &lt;amount&gt; - Set limits
• /pause / /unpause - Control trading
• /privacy - Toggle leaderboard visibility

<b>ℹ️ Other:</b>
• /start - View group info
• /leaderboard - View global leaderboard
• /help - Show this message`

  await ctx.reply(helpMessage, {
    parse_mode: 'HTML',
    reply_parameters: { message_id: ctx.msg.message_id },
  })
})
