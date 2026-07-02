import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'HeadcountPlanReconciler',
  description: 'Three-way reconciliation of your approved headcount plan against open reqs and actual hires.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
