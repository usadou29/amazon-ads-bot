'use client';
import React from 'react';
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'accent';
type Size = 'sm' | 'md' | 'lg';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean; fullWidth?: boolean; }
const variantStyles: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 border border-slate-200',
  danger: 'bg-status-danger text-white hover:opacity-90',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
  success: 'bg-status-success text-white hover:opacity-90',
  accent: 'bg-accent-500 text-white hover:bg-accent-600 font-semibold',
};
const sizeStyles: Record<Size, string> = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
export function Button({ variant = 'primary', size = 'md', loading = false, fullWidth = false, disabled, children, className = '', ...props }: ButtonProps) {
  return (<button disabled={disabled || loading} className={`inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${fullWidth ? 'w-full' : ''} ${className}`} {...props}>{loading && (<svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>)}{children}</button>);
}
