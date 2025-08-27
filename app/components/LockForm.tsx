"use client";

import { useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, BN, Idl, Wallet } from "@project-serum/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import idl from "../idl/time_locked_wallet.json";

const PROGRAM_ID = new PublicKey(
  (idl as { metadata: { address: string } }).metadata.address
);

export default function LockForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [unlockTime, setUnlockTime] = useState("");
  const [seed, setSeed] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const getProgram = useCallback(() => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    const provider = new AnchorProvider(connection, wallet as Wallet, {});
    return new Program(idl as Idl, PROGRAM_ID, provider);
  }, [connection, wallet]);

  const handleCreate = useCallback(async () => {
    try {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      const program = getProgram();
      const seedBn = new BN(seed);
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), wallet.publicKey.toBuffer(), seedBn.toArrayLike(Buffer, "le", 8)],
        PROGRAM_ID
      );
      const amountLamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
      const unlockTs = Math.floor(new Date(unlockTime).getTime() / 1000);
      await program.methods
        .initializeLock(
          new BN(amountLamports),
          new BN(unlockTs),
          null,
          wallet.publicKey,
          seedBn
        )
        .accounts({
          vault,
          creator: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus("Lock created");
      } catch (err) {
        setStatus((err as Error).message);
      }
  }, [amount, unlockTime, seed, wallet.publicKey, getProgram]);

  const handleWithdraw = useCallback(async () => {
    try {
      if (!wallet.publicKey) throw new Error("Wallet not connected");
      const program = getProgram();
      const seedBn = new BN(seed);
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), wallet.publicKey.toBuffer(), seedBn.toArrayLike(Buffer, "le", 8)],
        PROGRAM_ID
      );
      await program.methods
        .withdraw(seedBn)
        .accounts({
          vault,
          receiver: wallet.publicKey,
          creatorAccount: wallet.publicKey,
        })
        .rpc();
      setStatus("Withdrawn");
      } catch (err) {
        setStatus((err as Error).message);
      }
  }, [seed, wallet.publicKey, getProgram]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleCreate();
      }}
      className="max-w-md mx-auto p-4 flex flex-col gap-4"
    >
      <h1 className="text-2xl font-semibold text-center">Time Locked Wallet</h1>
      <input
        type="number"
        placeholder="Amount (SOL)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="border p-2 rounded"
      />
      <input
        type="datetime-local"
        value={unlockTime}
        onChange={(e) => setUnlockTime(e.target.value)}
        className="border p-2 rounded"
      />
      <input
        type="number"
        placeholder="Seed"
        value={seed}
        onChange={(e) => setSeed(e.target.value)}
        className="border p-2 rounded"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!wallet.publicKey}
          className="flex-1 bg-blue-600 text-white rounded py-2 disabled:opacity-50"
        >
          Create Lock
        </button>
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={!wallet.publicKey}
          className="flex-1 bg-green-600 text-white rounded py-2 disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>
      {status && <p className="text-center text-sm">{status}</p>}
    </form>
  );
}
