import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import { TimeLockedWallet } from "../target/types/time_locked_wallet";

function u64LeBytes(n: BN): Buffer {
  return Buffer.from(n.toArray("le", 8));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("time-locked-wallet (core flow)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.timeLockedWallet as Program<TimeLockedWallet>;

  it("initialize -> withdraw succeeds after unlock -> amount = 0 -> close_vault", async () => {
    const creator = provider.wallet as anchor.Wallet;
    const receiver = creator.publicKey; // self as receiver for simplicity

    // Prepare inputs
    const amount = new BN(1_000_000); // 0.001 SOL
    const now = Math.floor(Date.now() / 1000);
    const unlockTs = new BN(now + 6); // few seconds in the future (reduce flakiness)
    const seed = new BN(Date.now()); // pseudo-unique seed
    const rights = 0; // no authority

    // Derive expected PDA (not strictly needed for initialize when passing accounts, but useful to assert)
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), creator.publicKey.toBuffer(), u64LeBytes(seed)],
      program.programId
    );

    // Initialize the vault
    const txInit = await program.methods
      .initializeLock(amount, unlockTs, null, receiver, seed, rights)
      .accounts({
        vault: vaultPda,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    expect(txInit).to.be.a("string");

    // Wait until unlock comfortably
    await sleep(7000);

    // Withdraw should succeed now
    const txW = await program.methods
      .withdraw()
      .accounts({
        vault: vaultPda,
        receiver: receiver,
        creatorAccount: creator.publicKey,
      })
      .rpc();
    expect(txW).to.be.a("string");

    // Fetch account and ensure amount == 0 (not auto-closed)
    const acc = await program.account.timeLock.fetch(vaultPda);
    expect(Number(acc.amount)).to.equal(0);

    // Close by creator (manual delete)
    const txClose = await program.methods
      .closeVault()
      .accounts({ vault: vaultPda, creator: creator.publicKey })
      .rpc();
    expect(txClose).to.be.a("string");

    // Verify account is closed
    try {
      await program.account.timeLock.fetch(vaultPda);
      expect.fail("Vault account still exists after close");
    } catch (e) {
      // expected: account does not exist
    }
  });
});
