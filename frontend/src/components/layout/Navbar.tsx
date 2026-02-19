'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { theme } from '@/lib/theme/tokens';
import { t } from '@/lib/i18n';
export function Navbar() {
  const pathname = usePathname();
  const links = [{ href: '/authors', label: t('nav.authors') }, { href: '/settings', label: t('nav.settings') }];
  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link href="/authors" className="flex items-center gap-2">
            {theme.brand.logo ? (<img src={theme.brand.logo} alt={theme.brand.name} className="h-8" />) : (<span className="text-lg font-bold tracking-tight"><span className="text-brand-600">ENDRO</span><span className="text-accent-500">MEDE</span></span>)}
          </Link>
          <div className="flex items-center gap-1">
            {links.map((link) => { const isActive = pathname.startsWith(link.href); return (<Link key={link.href} href={link.href} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}>{link.label}</Link>); })}
          </div>
        </div>
      </div>
    </nav>
  );
}
