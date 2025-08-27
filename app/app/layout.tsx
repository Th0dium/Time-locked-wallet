"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function HomePage() {
  return (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      <h2>Welcome to Time Locked Wallet dApp</h2>
      <p>Connect your wallet to get started.</p>
      <WalletMultiButton />
    </div>
  );
}
