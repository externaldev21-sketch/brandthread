export type ThreadLoaderProps = {
  label?: string;
  compact?: boolean;
  className?: string;
};

export function ThreadLoader({ label = 'Loading', compact = false, className = '' }: ThreadLoaderProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={`inline-flex items-center gap-3 ${className}`}>
      <span className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none`} />
      {compact ? null : <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>}
    </div>
  );
}