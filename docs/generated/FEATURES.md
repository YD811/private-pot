# PotBot Feature Implementation Tracker

## Core Infrastructure
- [x] Database setup (Prisma + PostgreSQL)
- [x] Wallet management (Solana)
- [x] Encryption service for private keys
- [ ] Session persistence

## Deposit Flow
- [x] Group wallet generation
- [x] Deposit code generation
- [x] Deposit detection via memo
- [x] Ownership calculation
- [x] `/deposit` command
- [x] Transaction monitoring service

## Group Management
- [x] Group registration on `/start`
- [x] Group state tracking
- [x] Admin permission tracking
- [x] Group wallet association

## Trading
- [ ] Jupiter integration
- [ ] `/buy` command
- [ ] `/sell` command
- [ ] Trade limit enforcement
- [ ] Trade confirmation flow
- [ ] Transaction signing

## Portfolio & Info
- [ ] `/balance` command
- [ ] `/portfolio` command
- [ ] `/history` command
- [ ] `/members` command
- [ ] `/limits` command
- [ ] PnL calculation

## Admin Features
- [ ] `/add_trader` command
- [ ] `/remove_trader` command
- [ ] `/set_limit` command
- [ ] `/pause` command
- [ ] `/unpause` command

## Security & Safety
- [ ] Private key encryption at rest
- [ ] Permission middleware
- [ ] Rate limiting
- [ ] Transaction validation
- [ ] Audit logging

