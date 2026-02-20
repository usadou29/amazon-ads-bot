export const theme = {
  brand: {
    name: process.env.NEXT_PUBLIC_APP_NAME || 'ENDROMEDE',
    logo: '/icon.png' as string | null,
  },
  colors: {
    primary: {
      50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
      400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
      800: '#1e40af', 900: '#1e3a8a',
    },
    accent: {
      50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d',
      400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
      800: '#92400e', 900: '#78350f',
    },
    success: '#10b981', warning: '#f59e0b', danger: '#ef4444', info: '#2563eb',
    background: '#f1f5f9', surface: '#ffffff', surfaceHover: '#f8fafc',
    border: '#e2e8f0', borderLight: '#f1f5f9',
    textPrimary: '#0f172a', textSecondary: '#64748b', textMuted: '#94a3b8',
    textOnPrimary: '#ffffff', textOnAccent: '#78350f',
  },
  fonts: { sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", mono: "'Fira Code', monospace" },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2rem', '2xl': '3rem' },
  radius: { sm: '0.375rem', md: '0.5rem', lg: '0.75rem', xl: '1rem', full: '9999px' },
  shadows: { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', md: '0 4px 6px -1px rgb(0 0 0 / 0.1)', lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)' },
  breakpoints: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' },
  status: {
    success: { emoji: '✅', color: '#10b981', bg: '#ecfdf5' },
    warning: { emoji: '⚠️', color: '#f59e0b', bg: '#fffbeb' },
    danger:  { emoji: '🛑', color: '#ef4444', bg: '#fef2f2' },
  },
} as const;
export type Theme = typeof theme;
export type StatusType = keyof typeof theme.status;
