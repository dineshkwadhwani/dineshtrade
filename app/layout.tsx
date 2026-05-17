import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DineshTrade',
  description: 'Private Trading Desk — Dinesh Wadhwani',
  manifest: '/manifest.json',
  themeColor: '#080604',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-screen bg-[#080604]">{children}</body>
    </html>
  )
}
