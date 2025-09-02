# ⏳ Time-Locked Wallet (Solana + Anchor)

A minimal **time-locked SOL vault** built on Solana using Anchor, with a simple Next.js frontend.  
Supports an optional administrator (*authority*) with granular rights.  
Deployed to Devnet with a live demo.

- **Cluster:** Devnet (default)  
- **Program:** Anchor 0.31  
- **Frontend:** Next.js + Anchor client + Solana Wallet Adapter  


## 🚀 Live Demo

- **URL:** [time-locked-wallet-tau.vercel.app](https://time-locked-wallet-tau.vercel.app/)  
- **Program ID (Devnet):** `4ZGMpP8pQyC9FWQ1J1W9EMR3GvyTWuY5sDotgRqadXAb`  

### Quick Demo (Devnet)
1. Setup a wallet (Phantom, Solflare, Backpack) on Devnet *(do not use a wallet with real assets)*.  
2. Airdrop 2 SOL.  
3. **Create Vault:** amount `0.1 SOL`, unlock = now + 2 minutes, receiver = your wallet.  
4. **Withdraw:**  
   - Before unlock → on-chain withdraw fails.  
   - After unlock → click `Withdraw`. UI shows “Withdrawn at HH:MM:SS”.  
5. **Clean up:** when amount = 0, click `Delete Vaults` (reclaims rent).  


## 💡 Features

- Lock SOL into a **PDA vault** until a chosen unlock timestamp (enforced on-chain).  
- Optional **administrator (authority)** with granular rights:  
  - `set_receiver` (change beneficiary)  
  - `set_duration` (adjust unlock time)  
- Receiver can withdraw once unlocked.  
- Creator can close vault after funds are withdrawn.  
- Mobile-friendly UI with 3 tabs: **Create**, **Administrator**, **Withdraw**.  
- Frontend automatically lists vaults where the connected wallet matches either `creator`, `authority`, or `receiver`.  


## 📌 Use Cases

This program can serve as a **building block** for many trust- and time-based financial flows on Solana.  
Thanks to its **flexible role design** (creator, optional authority, and receiver), it can cover different real-world needs:

- **Grants with release schedules**  
  - DAO or project funders lock SOL for a beneficiary.  
  - An optional authority can adjust the receiver if the grantee misbehaves.  

- **DAO treasury disbursement**  
  - DAO members deposit SOL into a vault with a fixed unlock date.  
  - Authority (multisig) may extend or cancel before funds are released.  

- **Trust funds or parental savings**  
  - Parents (creator) lock funds for a child (receiver).  
  - If needed, authority can be assigned to a trusted third party for oversight.  

- **Time-based saving accounts**  
  - A user locks their own SOL as a form of commitment.  
  - Vault can be immutable (no authority) to ensure no early withdrawal.  

- **Escrow with supervision**  
  - Two parties agree on a vault.  
  - An external arbiter is set as authority to resolve disputes (by changing receiver or duration).  

This flexibility allows the program to adapt to **different governance and trust models** without needing to change core logic.


## Roles & Flow (Diagram)

```
                   Creator (signer, payer)                           
                      |                                                 
                      | decide who is authority/receiver               
                      | Fill the form                                               
                      | initialize_lock(amount, unlock_ts, ... )        
                      |                                                 
                      v                                                 
  +-----------------------------------------------------------------+
  |                      PDA Vault: TimeLock                        |
  | seeds: ["vault", creator_pubkey, seed_u64_le]                   |
  | fields: creator, authority?, receiver, amount, unlock_timestamp |
  +-----------------------------------------------------------------+
                        |                           ↑
                        |                           |
                Authority (if exit) => set_receiver / set_duration
                        |
                        | now < unlock_timestamp
                        v
                  Receiver withdraw -> Fail
                        |
                        | now > unlock_timestamp
                        v
                  Receiver withdraw -> Success
                        |
            unlock_timestamp repurpose as claimed timestamp
                        v
              Creator can close_vault() to reclaim rent
```

---

## 🔐 Roles & Behavior

- **Creator**: funds the vault, pays rent, can close after withdrawal.  
- **Receiver**: beneficiary; allowed to withdraw after unlock.  
- **Authority (optional)**: administrator with rights bitmask:  
  - `0`: none → vault is immutable.  
  - `1`: can change receiver.  
  - `2`: can change duration.  
  - `3`: both.  

### Post-Withdraw
- `amount = 0`.  
- `unlock_timestamp` overwritten with claim time (`claimed_at`).  
- Admin edits disabled.  

---

## ⚙️ Program (Anchor)

**Location:** `programs/time-locked-wallet`

### PDA
- Vault account seeds: `[b"vault", creator_pubkey, seed_u64_le]`  
- `seed` and `bump` are persisted on chain.  

### State
```rust
TimeLock {
  creator: Pubkey,
  authority: Option<Pubkey>,   // None => immutable
  receiver: Pubkey,
  amount: u64,                 // locked lamports
  unlock_timestamp: i64,       // unlock time; becomes claimed_at after withdraw
  seed: u64,
  authority_rights: u8,        // 1=set_receiver, 2=set_duration
  bump: u8,
}
