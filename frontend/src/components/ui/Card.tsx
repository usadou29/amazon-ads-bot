'use client';
import React from 'react';
interface CardProps { children: React.ReactNode; className?: string; onClick?: () => void; hoverable?: boolean; }
export function Card({ children, className = '', onClick, hoverable = false }: CardProps) {
  return (<div onClick={onClick} className={`bg-white border border-slate-200 rounded-card shadow-card p-4 ${hoverable ? 'hover:shadow-card-hover hover:border-slate-300 transition-all cursor-pointer' : ''} ${className}`}>{children}</div>);
}
export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <div className={`mb-3 ${className}`}>{children}</div>; }
export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <h3 className={`text-lg font-semibold text-slate-900 ${className}`}>{children}</h3>; }
export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <div className={className}>{children}</div>; }
export function CardFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <div className={`mt-4 pt-3 border-t border-slate-100 ${className}`}>{children}</div>; }
