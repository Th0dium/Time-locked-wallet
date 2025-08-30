## Overview
- Goal: Time-locked SOL vaults on Solana (Anchor) with a simple frontend (Next.js) for three roles: creator, authority, receiver.
- Authority is optional. If `authority = None`, the vault is immutable (no admin edits). Receiver is the only one who can withdraw after unlock time.

## Program (Anchor)
- Program ID: see `Time-locked-wallet/Anchor.toml`.
- PDA seeds for `vault`: `[b"vault", creator_pubkey, seed_u64_le]`.
- `seed` is stored on-chain in the account so later instructions don’t require passing it.

### Instructions
1) initialize_lock(amount: u64, unlock_timestamp: i64, authority: Option<Pubkey>, receiver: Pubkey, seed: u64, authority_rights: u8)
   - Create vault PDA and transfer `amount` SOL from creator to the PDA.
   - Persists: creator, authority (optional), receiver, amount, unlock_timestamp, seed, authority_rights, bump.
   - Validations: `amount > 0`, `unlock_timestamp > now`.
   - If `authority` is None then `authority_rights` must be 0.

2) withdraw()
   - Only `receiver` (signer; must equal `vault.receiver`).
   - Requires `now >= vault.unlock_timestamp`.
   - Transfers `vault.amount` to receiver and sets `amount = 0`.

3) set_receiver(new_receiver: Pubkey)
   - Only authority (signer) and only when `vault.authority == Some(authority_pubkey)`.
   - Requires right bit 0 (`authority_rights & 1 != 0`).
   - Disallowed when `vault.amount == 0` (AlreadyWithdrawn).
   - Updates `vault.receiver`.

4) set_duration(new_unlock_timestamp: i64)
   - Only authority (signer) and only when `vault.authority == Some(authority_pubkey)`.
   - Requires right bit 1 (`authority_rights & 2 != 0`).
   - Disallowed when `vault.amount == 0` (AlreadyWithdrawn).
   - Updates `vault.unlock_timestamp` (currently unconstrained; can increase/decrease).

5) close_vault()
   - Only `creator` (signer; must equal `vault.creator`).
   - Requires `vault.amount == 0` (all funds withdrawn).
   - Closes the vault PDA and refunds remaining lamports (rent) to the creator.

### Accounts
- InitializeLock: `{ vault (init; PDA by ["vault", creator, seed]), creator (Signer, payer), system_program }`
- Withdraw: `{ vault (PDA by ["vault", vault.creator, vault.seed]), receiver (Signer == vault.receiver), creator_account (SystemAccount == vault.creator) }`
- SetReceiver: `{ vault (PDA by ["vault", vault.creator, vault.seed]), authority (Signer) }`
- SetDuration: `{ vault (PDA by ["vault", vault.creator, vault.seed]), authority (Signer) }`
- CloseVault: `{ vault (PDA by ["vault", vault.creator, vault.seed]; close = creator), creator (Signer == vault.creator) }`

### State
```rust
#[account]
pub struct TimeLock {
    pub creator: Pubkey,              // Who created and funded
    pub authority: Option<Pubkey>,    // Admin (None => immutable)
    pub receiver: Pubkey,             // Who can withdraw
    pub amount: u64,                  // Locked amount (lamports)
    pub unlock_timestamp: i64,        // Unix timestamp
    pub seed: u64,                    // Stored on-chain seed
    pub authority_rights: u8,         // bitmask: 1=set_receiver, 2=set_duration
    pub bump: u8,                     // PDA bump
}
```

## Frontend Plan
- Wallet connect (Phantom/Backpack) via `@solana/wallet-adapter` + `@coral-xyz/anchor`.
- Tabs:
  - Create Vault: form for amount, unlock time, receiver, authority (self/other/None), random `u64` seed → derive PDA and call `initialize_lock`.
  - Administrator: list vaults where `account.authority == wallet.publicKey`; actions: `set_receiver`, `set_duration`.
  - Withdraw: list vaults where `account.receiver == wallet.publicKey`; action: `withdraw` (fails on-chain if too early).
- Listing approach (updated to avoid 429): Use memcmp filters to narrow results server-side, cache results on first page load, and refresh only on user action. Avoid repeated `.all()` on tab switches.
- Seed generation: FE generates a random `u64` for init; later ops don’t need seed since it’s stored on-chain.
- Update initializer form to include an “authority rights” control:
None: rights = 0 (and/or force authority = None)
Change receiver only: rights = 1
Change duration only: rights = 2
Both: rights = 3
## Decisions / Notes
- Amount semantics: withdraw uses the stored `amount`. Extra lamports sent later are returned to the creator when the account is closed.
- After withdrawal (`amount == 0`):
  - Authority cannot modify vault (set_receiver, set_duration will fail with `AlreadyWithdrawn`).
  - Withdraw tab shows status "Withdrawn" and disables the Withdraw button.
  - Creator can delete (close) the vault from the "Vaults Created" list once `amount == 0`.
- Frontend UX:
  - Creator tab shows a "Your Vaults" list with Refresh and memcmp-based fetch by creator.
  - Withdraw tab shows real-time unlock countdown; status updates after unlock.
- Tests: `tests/time-locked-wallet.ts` targets an older API and must be updated to match the current instruction signatures and PDA seeds.
- The set_duration instruction can be very dangerous, as misuse or griefing scenarios could basically trash the whole vault.
- RPC rate limits (HTTP 429): Public Devnet/Mainnet endpoints limit request rates. Solutions:
  - Add refresh cooldown (5 seconds)
  - Use memcmp filters for `getProgramAccounts` to reduce payload.
  - Support custom RPC via `NEXT_PUBLIC_RPC_URL` (see frontend/app/providers.tsx) to use a dedicated endpoint with higher quotas.
