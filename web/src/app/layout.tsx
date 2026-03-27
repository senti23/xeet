import { Outfit, Space_Mono, Playfair_Display } from 'next/font/google';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-space-mono',
});
const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['italic'],
  variable: '--font-playfair',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`bg-gray-950 text-gray-100 min-h-screen ${outfit.variable} ${spaceMono.variable} ${playfair.variable} font-[family-name:var(--font-outfit)]`}>
        {children}
      </body>
    </html>
  );
}
