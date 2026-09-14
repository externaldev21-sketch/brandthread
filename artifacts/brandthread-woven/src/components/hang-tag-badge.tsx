import type { ReactNode } from 'react';

export type HangTagBadgeProps = {
  children: ReactNode;
  variant?: 'live' | 'drop' | 'sale' | 'status';
  className?: string;
};

export function HangTagBadge({ children, variant = 'status', className = '' }: HangTagBadgeProps) {
  const tone = variant === 'live'
    ? 'bg-destructive text-destructive-foreground'
    : variant === 'status'
      ? 'bg-secondary text-secondary-foreground'
      : 'bg-primary text-primary-foreground';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${tone} ${className}`}>
      {variant === 'live' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" /> : null}
      {children}
    </span>
  );
}