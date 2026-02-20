import type { Metadata } from 'next';
import './globals.css';
import { ClientLayout } from './client-layout';
export const metadata: Metadata = { title: 'ENDROMEDE — Optimize your Amazon Ads', description: 'Gestion intelligente des Amazon Ads pour auteurs KDP' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html lang="fr"><body><ClientLayout>{children}</ClientLayout></body></html>); }
