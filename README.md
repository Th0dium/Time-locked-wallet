# ⏳ Time-Locked Wallet (Solana + Anchor)

A minimal **time-locked SOL vault** built on Solana using Anchor, with a simple Next.js frontend.  
Supports an optional administrator (*authority*) with granular rights.  
Deployed to Devnet with a live demo.

- **Cluster:** Devnet (default)  
- **Program:** Anchor 0.31  
- **Frontend:** Next.js + Anchor client + Solana Wallet Adapter  

## 💡 Features

- Lock SOL into a **PDA vault** until a chosen unlock timestamp (enforced on-chain).  
- Optional **administrator (authority)** with granular rights:  
  - `set_receiver` (change beneficiary)  
  - `set_duration` (adjust unlock time)  
- Receiver can withdraw once unlocked.  
- Creator can close vault after funds are withdrawn.  
- Mobile-friendly UI with 3 tabs: **Create**, **Administrator**, **Withdraw**.  
- Frontend automatically lists vaults where the connected wallet matches either `creator`, `authority`, or `receiver`.  
- Withdraw tab includes a live countdown timer until unlock.  

## 🚀 Live Demo (Vercel)

- **URL:** [time-locked-wallet-tau.vercel.app](https://time-locked-wallet-tau.vercel.app/)  
- **Program ID (Devnet):** `4ZGMpP8pQyC9FWQ1J1W9EMR3GvyTWuY5sDotgRqadXAb`  

![Demo Screenshot](./assests/Preview.png)

### Quick Demo Flow (3 minutes)
1. Setup a wallet (Phantom, Solflare, Backpack) on Devnet *(please do not use a wallet with real assets)*.  
2. Airdrop 1-2 SOL: get test SOL from Solana faucet (https://faucet.solana.com/)  
3. **Create Vault:** amount `0.1 SOL`, unlock = now + 2 minutes, receiver = your wallet, authority = none.  
4. **Withdraw:**  
   - Before unlock → on-chain withdraw fails.  
   - After unlock → click `Withdraw`. UI shows “Withdrawn at HH:MM:SS”  
5. **Clean up:** when amount = 0, click `Delete Vault` (reclaims rent).  

### Admin Demo Flow (optional)

You can try administrator actions without switching wallets by setting yourself as authority during creation.

- A) Change Unlock time (rights: set_duration)
  1. Create a vault with: amount 0.1 SOL, `unlock` = now + a decade, `receiver` = your wallet, `authority` = your wallet, authority rights = `Change unlock time` (or `both`)
  2. Open the Administrator tab, select the vault, set a new unlock time (e.g., now + 1 minute) and click `Set Duration`.
  3. Go to Withdraw tab: the countdown updates to the new unlock; withdraw after it reaches zero.

- B) Change Receiver (rights: set_receiver)
  1. Create a vault with: amount 0.1 SOL, `unlock` = now + 2 minutes, `receiver` = any valid pubkey that is NOT your wallet (e.g., your pubkey but mistyped), `authority` = your wallet, authority rights = `Change receiver` (or `both`).
  2. Open the Withdraw tab, there would be no vault shown.
  3. Go to Administrator tab: set receiver to your wallet and click `Set Receiver`.
  3. Withdraw tab: the vault now appears under your address; wait for unlock and withdraw.

Notes:
- Admin edits are disabled after withdrawal (`amount == 0`).
- Vault deletion is not mandatory
## Getting Started (Recommended: Deploy First)

1) Prerequisites
- Node.js 18+ and npm
- Solana CLI and a Devnet keypair at `~/.config/solana/id.json`
- Anchor CLI 0.31.x

2) Configure Devnet and fund your wallet
```
solana config set --url https://api.devnet.solana.com
solana airdrop 2
```

3) Build and deploy the Anchor program (Devnet)
```
anchor build
anchor deploy
```
Copy the printed `Program Id` or use: 
`solana address -k target/deploy/time_locked_wallet-keypair.json`

4) Point the frontend to your program
- Set `PROGRAM_ID` in `frontend/src/utils/anchor.ts:1` to your Program Id.
- Replace `frontend/src/idl/time_locked_wallet.json` with `target/idl/time_locked_wallet.json`.

5) Run the frontend
```
cd frontend
npm i
echo NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com > .env.local
npm run dev
```
Open http://localhost:3000 and connect a wallet (switched to devnet).

6) Run tests (Mocha/Chai)
- Location: `tests/simple.spec.ts` — covers input validations, lifecycle (initialize → withdraw after unlock → close), and admin rights bitmask.  
- Prerequisites: set Anchor env variables to use Devnet and your keypair.  
  - PowerShell (Windows):  
    - `$env:ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com"`  
    - `$env:ANCHOR_WALLET = "$env:USERPROFILE\.config\solana\id.json"`  
  - Bash (WSL/macOS/Linux):  
    - `export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`  
    - `export ANCHOR_WALLET=~/.config/solana/id.json`  
- Run: `npm run test` (root) — uses `ts-mocha` with the project `tsconfig.json`.  
- Notes: tests execute real Devnet transactions; ensure the wallet has SOL (e.g., `solana airdrop 2`).  

## Quick Start (Devnet, Pre‑deployed Program)

Use the already deployed Devnet program ID shown above.

1) Prerequisites
- Node.js 18+ and npm
- Solana CLI (`solana --version`) and a Devnet keypair at `~/.config/solana/id.json`
- Anchor CLI 0.31.x (`anchor --version`)

2) Configure Solana for Devnet and fund your wallet
```
solana config set --url https://api.devnet.solana.com
solana airdrop 3
```

3) Run the frontend
```
cd frontend
npm install
echo NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com > .env.local
npm run dev
```
Open http://localhost:3000, connect a Devnet wallet (Phantom/Solflare/Backpack), create a vault, and test withdraw after unlock.

## Run The Anchor Program

Only needed if you plan to change on‑chain code or deploy your own program ID.

1) Build and deploy
```
anchor build

# Deploy to Devnet (requires enough SOL in your wallet)
anchor deploy
```
Record the new `Program Id` printed by Anchor.

2) Update the program ID in multiple files
- Update the program ID in [programs.devnet] in Anchor.toml
- Edit `programs/time-locked-wallet/src/lib.rs` and update the declare_id!() macro
- Edit `frontend/src/utils/anchor.ts` and set `PROGRAM_ID` to your new program id.
- Update `frontend/src/idl/time_locked_wallet.json` with the freshly built IDL from `target/idl/time_locked_wallet.json` (replace the file).

3) Rebuild and restart
```
anchor build # Rebuild with updated program ID
cd frontend
npm run dev
```

## Troubleshooting

- ANCHOR_PROVIDER_URL is not defined: set environment variables for tests
  - PowerShell: `$env:ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"; $env:ANCHOR_WALLET="$env:USERPROFILE\.config\solana\id.json"`
  - Bash: `export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com; export ANCHOR_WALLET=~/.config/solana/id.json`
- Not enough SOL: run `solana airdrop 2` (may repeat) on Devnet.
- Frontend can’t send tx: ensure wallet is connected to Devnet and `NEXT_PUBLIC_RPC_URL` is a Devnet endpoint.



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
                        |                           Ʌ
                        |                           |
                Authority (if exit) => set_receiver or set_duration 
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
- `unlock_timestamp` overwritten with claim time.  
- Admin edits disabled.  

### Note on `unlock_timestamp` Repurposing:
After withdrawal, we overwrite `unlock_timestamp` with the claim timestamp. While the withdrawal transaction itself provides cryptographic proof of execution, this design choice offers:
- **Direct state queries:** Other programs/UIs can check vault status without analyzing transaction history
- **Simplified composability:** Single field read vs. RPC historical queries
- **Account space efficiency:** No field wasted!

**Reality check:** This is probably unnecessary. The blockchain transaction already proves when withdrawal happened. This feature explores on-chain state patterns but honestly, most apps don't need it. The transaction record is typically enough proof.

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
  authority_rights: u8,        // 1=set_receiver, 2=set_duration, 3=both
  bump: u8,
}
```

## ✅ Bounty Submission - Time-Locked Wallet on Solana
This project was built as a submission for the Solana Developer Talent Layer bounty program organized by SuperteamVN on earn.superteam
## Requirements Completed
- [x] initialize_lock(amount, unlock_timestamp) instruction
- [x] withdraw() instruction  
- [x] PDA holds locked funds
- [x] On-chain lock enforcement 
<br>
<br>

- [x] Frontend form for creating locks
- [x] Display wallet state & unlock date
- [x] Withdraw button (fails if too early)
- [x] Phantom/Backpack wallet support
<br>
<br>

- [x] GitHub repo with program + frontend
- [x] This README with setup instructions
- [x] deployed to devnet with live demo
<br>
<br>

- [x] Add a countdown timer to unlock in the UI
- [x] Write a simple test using Mocha/Chai or Anchor CLI
- [ ] Use USDC (SPL token) instead of just SOL


What started as a 7-day beginner bounty became a comprehensive DeFi primitive that goes beyond the basic requirements.
### **📬 Contact & Links**
- Developer: Thodium
- My gmail: nhatduy3354@gmail.com
- DSUC - DUT Superteam University Club (Da Nang University of Technology)
- telegram: @Th0di
- X(Twitter):@Th0rDium (these are dead accounts btw)
- Project link: https://github.com/Th0dium/Time-locked-wallet

*built with ❤️ and lots of coffee by Thodium*


