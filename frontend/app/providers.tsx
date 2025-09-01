"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import "@solana/wallet-adapter-react-ui/styles.css";

const DEVNET_ENDPOINT = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
// Public URL of your site for mobile deep linking (ngrok / vercel / domain)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const NETWORK: WalletAdapterNetwork = WalletAdapterNetwork.Devnet;

export default function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => {
    return [
      // Hint wallets about your app URL and cluster for mobile deep links
      new PhantomWalletAdapter({ appUrl: APP_URL, cluster: "devnet" }),
      new SolflareWalletAdapter({ network: NETWORK }),
      new BackpackWalletAdapter(),
    ];
  }, []);

  return (
    <ConnectionProvider endpoint={DEVNET_ENDPOINT} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
