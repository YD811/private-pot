# PotBot - Product Spec

## What it is

Telegram bot that turns your groupchat into a trading fund. One shared Solana wallet per group. Members deposit, traders swap, everyone owns a %.

## How it works

**Backend managed wallets**
- Bot generates one wallet per Telegram group
- Private keys encrypted in database
- No smart contracts, all logic in backend
- Bot signs all transactions

**Deposits**
- User gets unique code
- Sends SOL to group wallet with code in memo
- Bot detects tx, credits user in database
- Ownership % = your deposits / total deposits

**Trading**
- Designated traders can buy/sell tokens
- Uses Jupiter for swaps
- Trade limits enforced by bot
- All trades from group wallet

**Permissions**
- Admin = Telegram group admin
- Trader = member with trading permission
- Member = anyone who deposited

## Core Features

**Pooled funds**
- One wallet holds all deposits
- Track individual ownership in database
- No withdrawals in MVP

**Role based trading**
- Admins assign trader role
- Traders execute swaps within limits
- Per-transaction limits
- Daily volume limits

**Portfolio tracking**
- View all holdings
- Track PnL per position
- Trade history with attribution
- Member leaderboard

**Safety controls**
- Trade confirmations required
- Admin can pause trading
- Limits enforced before execution

## Commands

### Setup
- `/start` - Initialize group wallet ✅

### Deposits
- `/deposit` - Get deposit code and address ✅

### Info
- `/balance` - View holdings ✅
- `/portfolio` - Holdings with PnL ✅
- `/history` - Recent trades ✅
- `/members` - All members and ownership % ✅
- `/limits` - Your trade limits ✅

### Withdrawals (bonus feature)
- `/withdraw <amount>` - Withdraw funds ✅

### Trading (traders only)
- `/buy <token> <amount>` - Buy tokens ✅
- `/sell <token> <amount>` - Sell tokens ✅

### Admin
- `/add_trader @user` - Grant trading permission ✅
- `/remove_trader @user` - Revoke permission ✅
- `/set_limit @user <amount>` - Set trade limits ❌ (missing)
- `/pause` - Stop all trading ✅
- `/unpause` - Resume trading ✅

## Data Storage

Everything in PostgreSQL:
- Groups and wallet addresses
- Member deposits and ownership
- Trade history
- Positions and PnL
- Permissions and limits
- Deposit codes

Encrypted wallet private keys stored in database.

## Trade Flow

1. Trader sends `/buy JUP 2`
2. Bot checks permissions and limits
3. Fetches Jupiter quote
4. Shows proposal with buttons
5. Trader clicks Execute
6. Bot signs tx with group wallet
7. Swap executes on Solana
8. Records trade in database
9. Updates positions and PnL

## Security Model

**Trust assumptions:**
- Users trust bot operator
- Bot has full control of funds
- Not trustless like smart contracts

**Security measures:**
- Encrypted private keys
- Trade limits enforced
- Admin controls
- Audit trail in database

## Tradeoffs

**Pros:**
- Simple to build
- Fast iteration
- No smart contract complexity
- Easy to add features

**Cons:**
- Centralized (bot controls everything)
- Single point of failure
- Users must trust operator

## MVP Scope

**In: (✅ = implemented)**
- Wallet generation ✅
- Deposits with codes ✅
- Buy/sell via Jupiter ✅
- Portfolio tracking ✅
- Role management ✅
- Trade limits ✅ (view only, set_limit command missing)

**Out:**
- Smart contracts
- Multiple wallets per group
- Profit distribution
- Voting mechanisms

**Bonus Features (implemented beyond MVP):**
- Withdrawals ✅