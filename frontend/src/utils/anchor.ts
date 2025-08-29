"use client";

import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../idl/time_locked_wallet.json";
import { WalletContextState } from "@solana/wallet-adapter-react";

// Single source of truth for program ID to avoid IDL/address mismatches
export const PROGRAM_ID = new PublicKey("4ZGMpP8pQyC9FWQ1J1W9EMR3GvyTWuY5sDotgRqadXAb");

export const DEVNET_ENDPOINT = "https://api.devnet.solana.com";

export function getConnection(): Connection {
  return new Connection(DEVNET_ENDPOINT, "confirmed");
}

export function getProvider(wallet: WalletContextState): AnchorProvider {
  const connection = getConnection();
  // WalletContextState conforms to Wallet interface expected by AnchorProvider
  // as long as wallet.signTransaction is available (after connect)
  return new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
}

export function getProgram(wallet: WalletContextState) {
  const provider = getProvider(wallet);
  // Ensure the IDL has the correct `address` field expected by Anchor clients
  const idlWithAddress = { ...(idl as any), address: PROGRAM_ID.toBase58() } as Idl;
  // Anchor (browser build) constructor: (idl, provider?, coder?)
  return new Program(idlWithAddress, provider);
}

export function getVaultPda(creator: PublicKey, seed: BN): [PublicKey, number] {
  const seedLe = Buffer.from(seed.toArray("le", 8));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), creator.toBuffer(), seedLe],
    PROGRAM_ID
  );
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000));
}

export function lamportsToSol(lamports: bigint | number): number {
  const v = typeof lamports === "bigint" ? Number(lamports) : lamports;
  return v / 1_000_000_000;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function randomU64BN(): BN {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  const big = (BigInt(a[0]) << 32n) | BigInt(a[1]);
  return new BN(big.toString());
}
