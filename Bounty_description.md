**🏆 Bounty: Build a Time-Locked Wallet on Solana**
**Prize Pool:** 150 - 100 - 50 USDC
**Duration:** 7 days
**Level:** Beginner-friendly (Solana Program + simple Frontend)
**🔧 Objective**
Create a **Solana smart contract** and **simple frontend** for a Time-Locked Wallet:
* A user deposits SOL or USDC into a PDA account.
* Funds are **locked until a specified unlock timestamp**.
* After the unlock time, the user (or designated recipient) can withdraw the funds.
**💡 Why It Matters**
This is a basic building block for many on-chain use cases:
* Grants with release schedules
* DAO-controlled disbursements
* Trust funds or delayed payouts
* Parental wallets or time-based savings
**✅ Deliverables**
To qualify for the prize, your submission must include:
**1. Solana Program (using Anchor)**
* ✅ Instruction: initialize_lock(amount, unlock_timestamp)
* ✅ Instruction: withdraw()
* ✅ Program owns a PDA account that holds the locked funds
* ✅ Lock must be enforced on-chain (not just frontend)
**2. Frontend**
* ✅ Form to create a time-locked wallet (input: amount + unlock time)
* ✅ Display wallet state (amount locked, unlock date)
* ✅ Button to withdraw if eligible (should fail if too early)
* ✅ Works with Phantom or Backpack wallet
**3. Public GitHub Repo**
* ✅ Program folder (Anchor)
* ✅ Frontend folder (React or Svelte or HTML/JS)
* ✅ README.md with clear instructions to run both
* ✅ Optional: deploy to devnet and include test account/demo
**🧪 Bonus (Not Required)**
You’ll earn bonus points if you:
* Use USDC (SPL token) instead of just SOL
* Add a countdown timer to unlock in the UI
* Write a simple test using Mocha/Chai or Anchor CLI