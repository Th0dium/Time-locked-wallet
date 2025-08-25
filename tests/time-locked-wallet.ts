import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TimeLockedWallet } from "../target/types/time_locked_wallet";
import { expect } from "chai";

describe("time-locked-wallet", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.timeLockedWallet as Program<TimeLockedWallet>;
  const provider = anchor.getProvider();

  let vaultPda: anchor.web3.PublicKey;
  let bump: number;

  before(async () => {
    // Find the PDA for the vault
    [vaultPda, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), provider.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Creates a time lock", async () => {
    const amount = new anchor.BN(1000000000); // 1 SOL in lamports
    const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 60); // 1 minute from now

    const tx = await program.methods
      .initializeLock(amount, unlockTimestamp)
      .accounts({
        authority: provider.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Time lock created with transaction signature:", tx);

    // Verify the vault account was created
    const vaultAccount = await program.account.timeLock.fetch(vaultPda);
    expect(vaultAccount.authority.toString()).to.equal(provider.publicKey.toString());
    expect(vaultAccount.amount.toString()).to.equal(amount.toString());
    expect(vaultAccount.unlockTimestamp.toString()).to.equal(unlockTimestamp.toString());
  });

  it("Fails to withdraw before unlock time", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          vault: vaultPda,
          authority: provider.publicKey,
          recipient: provider.publicKey,
        })
        .rpc();

      // Should not reach here
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.message).to.include("StillLocked");
    }
  });

  it("Successfully withdraws after unlock time", async () => {
    // Create a new time lock with immediate unlock time
    const amount = new anchor.BN(500000000); // 0.5 SOL in lamports
    const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) - 1); // 1 second ago

    // Create a new keypair for this test to avoid PDA conflicts
    const newAuthority = anchor.web3.Keypair.generate();

    // Airdrop some SOL to the new authority
    const airdropTx = await provider.connection.requestAirdrop(
      newAuthority.publicKey,
      2000000000 // 2 SOL
    );
    await provider.connection.confirmTransaction(airdropTx);

    const [newVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), newAuthority.publicKey.toBuffer()],
      program.programId
    );

    // Create the time lock
    await program.methods
      .initializeLock(amount, unlockTimestamp)
      .accounts({
        vault: newVaultPda,
        authority: newAuthority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([newAuthority])
      .rpc();

    // Get balance before withdrawal
    const balanceBefore = await provider.connection.getBalance(newAuthority.publicKey);

    // Withdraw the funds
    const tx = await program.methods
      .withdraw()
      .accounts({
        vault: newVaultPda,
        authority: newAuthority.publicKey,
        recipient: newAuthority.publicKey,
      })
      .signers([newAuthority])
      .rpc();

    console.log("Withdrawal successful with transaction signature:", tx);

    // Verify balance increased
    const balanceAfter = await provider.connection.getBalance(newAuthority.publicKey);
    expect(balanceAfter).to.be.greaterThan(balanceBefore);
  });
});
