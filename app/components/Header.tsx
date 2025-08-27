"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Header() {
  return (
    <header className="p-4 flex justify-end">
      <WalletMultiButton />
    </header>
  );
}
