"use client";

import './globals.css'
import { ReactNode } from 'react'
import { Providers } from '../providers'
import Header from '../components/Header'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  )
}
