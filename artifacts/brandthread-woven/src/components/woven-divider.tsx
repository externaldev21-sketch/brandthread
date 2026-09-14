import type { HTMLAttributes } from 'react';

export type WovenDividerProps = HTMLAttributes<HTMLDivElement> & {
  variant?: 'stitch' | 'section' | 'quiet';
  label?: string;
};

export function WovenDivider({
  variant = 'quiet',
  label,
  className = '',
  ...props
}: WovenDividerProps) {
  const line = variant === 'quiet'
    ? 'opacity-45'
    : variant === 'section'
      ? 'opacity-100'
      : 'opacity-70';
  return (
    <div aria-hidden="true" className={`flex items-center gap-3 py-2 ${className}`} {...props}>
      <span className={`h-px min-w-5 flex-1 bg-border ${line}`} />
      {label ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
      ) : null}
      {label ? <span className={`h-px flex-1 bg-border ${line}`} /> : null}
      {variant === 'section' ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
    </div>
  );
}