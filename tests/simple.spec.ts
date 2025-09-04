import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import type { TimeLockedWallet } from "../target/types/time_locked_wallet";

  ///Fun fact: this is the first time i see a test suite
  ///i guess it's just a way to make sure some scenario works
describe("Time-Locked Wallet Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.timeLockedWallet as Program<TimeLockedWallet>;
  
  const creator = provider.wallet as anchor.Wallet;

  // Helper function to get vault PDA
  const getVaultPDA = (creator: PublicKey, seed: anchor.BN) => {
    return PublicKey.findProgramAddressSync([
      Buffer.from("vault"),
      creator.toBuffer(),
      seed.toArrayLike(Buffer, "le", 8)
    ], program.programId);
  };

  // Helper function to sleep
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  it("Should create a time lock successfully", async () => {
    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 10); // 10 seconds
    const seed = new anchor.BN(Date.now());
    const receiver = creator.publicKey; // Simple case: creator is receiver
    
    const [vaultPDA] = getVaultPDA(creator.publicKey, seed);

    await program.methods
      .initializeLock(
        amount,
        unlockTimestamp, 
        null,           // no authority
        receiver,       // receiver same as creator
        seed,
        0               // no admin rights
      )
      .accounts({
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify the vault was created correctly
    const vaultAccount = await program.account.timeLock.fetch(vaultPDA);
    
    expect(vaultAccount.creator.toString()).to.equal(creator.publicKey.toString());
    expect(vaultAccount.receiver.toString()).to.equal(receiver.toString());
    expect(vaultAccount.amount.toString()).to.equal(amount.toString());
    expect(vaultAccount.unlockTimestamp.toString()).to.equal(unlockTimestamp.toString());
    expect(vaultAccount.authority).to.be.null;
    expect(vaultAccount.authorityRights).to.equal(0);

    console.log("✅ Time lock created successfully");
  });

  it("Should prevent early withdrawal", async () => {
    const amount = new anchor.BN(0.05 * LAMPORTS_PER_SOL);
    const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
    const seed = new anchor.BN(Date.now() + 1);
    const receiver = creator.publicKey;
    
    const [vaultPDA] = getVaultPDA(creator.publicKey, seed);

    // Create vault
    await program.methods
      .initializeLock(amount, unlockTimestamp, null, receiver, seed, 0)
      .accounts({
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Try to withdraw immediately - should fail
    try {
      await program.methods
        .withdraw()
        .accounts({
          vault: vaultPDA,
          receiver: creator.publicKey,
          creatorAccount: creator.publicKey,
        })
        .rpc();
      
      expect.fail("Early withdrawal should have failed");
    } catch (error) {
      expect(error.toString()).to.include("StillLocked");
      console.log("✅ Early withdrawal correctly prevented");
    }
  });

  it("Should allow withdrawal after unlock time", async () => {
    const amount = new anchor.BN(0.02 * LAMPORTS_PER_SOL);
    const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3); // 3 seconds
    const seed = new anchor.BN(Date.now() + 2);
    const receiver = creator.publicKey;
    
    const [vaultPDA] = getVaultPDA(creator.publicKey, seed);

    // Create vault
    await program.methods
      .initializeLock(amount, unlockTimestamp, null, receiver, seed, 0)
      .accounts({
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Get initial balance
    const initialBalance = await provider.connection.getBalance(creator.publicKey);

    // Wait for unlock time
    console.log("⏳ Waiting for unlock time...");
    await sleep(4000);

    // Withdraw should succeed now
    await program.methods
      .withdraw()
      .accounts({
        vault: vaultPDA,
        receiver: creator.publicKey,
        creatorAccount: creator.publicKey,
      })
      .rpc();

    // Verify vault state
    const vaultAccount = await program.account.timeLock.fetch(vaultPDA);
    expect(vaultAccount.amount.toString()).to.equal("0");

    // Verify balance increased (accounting for transaction fees)
    const finalBalance = await provider.connection.getBalance(creator.publicKey);
    expect(finalBalance).to.be.greaterThan(initialBalance - 0.01 * LAMPORTS_PER_SOL); // Allow for tx fees

    console.log("✅ Withdrawal after unlock successful");
  });

  it("Should handle invalid inputs correctly", async () => {
    const seed = new anchor.BN(Date.now() + 3);
    const receiver = creator.publicKey;
    const now = Math.floor(Date.now() / 1000);
    
    const [vaultPDA] = getVaultPDA(creator.publicKey, seed);

    // Test invalid amount (0)
    try {
      await program.methods
        .initializeLock(
          new anchor.BN(0), 
          new anchor.BN(now + 300), 
          null, 
          receiver, 
          seed, 
          0
        )
        .accounts({
          vault: vaultPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      expect.fail("Should reject zero amount");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }

    // Test invalid timestamp (past)
    const seed2 = new anchor.BN(Date.now() + 4);
    const [vaultPDA2] = getVaultPDA(creator.publicKey, seed2);
    
    try {
      await program.methods
        .initializeLock(
          new anchor.BN(1000), 
          new anchor.BN(now - 1), // Past timestamp
          null, 
          receiver, 
          seed2, 
          0
        )
        .accounts({
          vault: vaultPDA2,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      expect.fail("Should reject past unlock time");
    } catch (error) {
      expect(error.toString()).to.include("InvalidUnlockTime");
    }

    console.log("✅ Input validation working correctly");
  });
});