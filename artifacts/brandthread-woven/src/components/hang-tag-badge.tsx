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
    <span className={`relative inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] [clip-path:polygon(8px_0,100%_0,100%_100%,8px_100%,0_50%)] ${tone} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full border border-current opacity-75" />
      {variant === 'live' ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" /> : null}
      {children}
      <span className="pointer-events-none absolute -left-3 top-1/2 h-px w-4 -translate-y-1/2 bg-current opacity-60" />
    </span>
  );
}