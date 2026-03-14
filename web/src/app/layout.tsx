import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Xeet Creator Cards — Market Intelligence',
  description: 'Live listings, prices, and alerts for Xeet Creator Cards across all marketplaces',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight">
              Xeet Creator Cards
              <span className="text-gray-500 font-normal ml-2 text-sm">Market Intel</span>
            </h1>
          </div>
        </header>
        <main className="max-w-screen-2xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
