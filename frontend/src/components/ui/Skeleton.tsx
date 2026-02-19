'use client';
import React from 'react';
export function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse bg-slate-200 rounded-md ${className}`} />; }
export function CardSkeleton() { return (<div className="bg-white border border-slate-200 rounded-card shadow-card p-4 space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><div className="space-y-2 mt-4"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div></div>); }
