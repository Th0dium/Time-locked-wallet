"use client";

import './globals.css'
import { ReactNode } from 'react'
import { Providers } from '../providers'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="p-4 flex justify-end">
            <WalletMultiButton />
          </header>
          {children}
        </Providers>
      </body>
    </html>
  )
}
