import type { Metadata } from 'next';
import './globals.css';
import { ClientLayout } from './client-layout';
import { Inter, Playfair_Display } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' });

export const metadata: Metadata = { 
  title: 'ENDROMEDE — Optimize your Amazon Ads', 
  description: 'Gestion intelligente des Amazon Ads pour auteurs KDP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) { 
  return (
    <html lang="fr" className={`${inter.variable} ${playfair.variable}`}>
      <body className="font-sans antialiased">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  ); 
}
