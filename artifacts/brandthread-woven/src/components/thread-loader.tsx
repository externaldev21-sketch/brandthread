import type { CSSProperties } from 'react';

export type ThreadLoaderProps = {
  label?: string;
  compact?: boolean;
  className?: string;
};

export function ThreadLoader({ label = 'Threading', compact = false, className = '' }: ThreadLoaderProps) {
  const style = { '--thread-distance': compact ? '4.5rem' : '12rem' } as CSSProperties;
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={`inline-flex flex-col gap-3 ${className}`}>
      <div className={`relative overflow-hidden ${compact ? 'h-3 w-24' : 'h-5 w-56'}`} style={style}>
        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
        <span className="thread-run absolute left-0 top-1/2 h-px w-16 -translate-y-1/2 bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
        <span className="thread-needle absolute left-0 top-1/2 h-2 w-4 -translate-y-1/2 rounded-[50%] border border-primary bg-background" />
      </div>
      {compact ? null : <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>}
      <style>{`
        @keyframes thread-run { from { transform: translate3d(-4rem,-50%,0); } to { transform: translate3d(var(--thread-distance),-50%,0); } }
        .thread-run,.thread-needle { animation: thread-run 1.15s cubic-bezier(.65,0,.35,1) infinite; }
        @media (prefers-reduced-motion: reduce) { .thread-run,.thread-needle { animation: none; transform: translate3d(2rem,-50%,0); } }
      `}</style>
    </div>
  );
}