# 🏆 Time-Locked Wallet MVP - Detailed Plan

## 📋 Project Overview
- **Goal**: Build a Time-Locked Wallet on Solana to win 150-100-50 USDC bounty  
- **Timeline**: 6 days remaining  
- **Level**: Beginner-friendly  
- **Tech Stack**: Solana Program (Anchor) + Frontend (React/Next.js)  

---

## 🎯 MVP Core Features

### Phase 1: Smart Contract (Days 1-2)

#### ✅ Required Functions:
1. **initialize_lock(amount, unlock_timestamp)**
   - Create PDA account to hold locked funds  
   - Transfer SOL from user wallet to PDA  
   - Store lock metadata (authority, amount, unlock_time, bump)  
   - Emit event log  

2. **withdraw()**
   - Check current timestamp vs unlock_timestamp  
   - Verify authority (only locker can withdraw)  
   - Transfer all locked SOL back to user  
   - Close PDA account (optional)  

#### ✅ Data Structure:
```rust
#[account]
pub struct TimeLock {
    pub authority: Pubkey,     // Who can withdraw
    pub amount: u64,           // Locked amount in lamports
    pub unlock_timestamp: i64, // Unix timestamp when unlock
    pub bump: u8,              // PDA bump seed
}
