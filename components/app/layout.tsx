import type { Metadata, Viewport } from 'next'
import './globals.css'
import AppFooter from '@/components/layout/AppFooter'

export const metadata: Metadata = {
  title: 'DineshTrade',
  description: 'Private Trading Desk — Dinesh Wadhwani',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#061426',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('dt-light')==='1'){document.documentElement.classList.add('light')}}catch(e){}",
          }}
        />
      </head>
      <body className="flex flex-col min-h-screen">
        <div className="flex-1">{children}</div>
        <AppFooter />
      </body>
    </html>
  )
}
