export type StitchedAvatarProps = {
  src?: string;
  alt: string;
  initials?: string;
  size?: 32 | 40 | 56 | 72;
  status?: 'none' | 'online' | 'live';
  className?: string;
};

export function StitchedAvatar({ src, alt, initials, size = 56, status = 'none', className = '' }: StitchedAvatarProps) {
  return (
    <span
      className={`relative inline-grid place-items-center rounded-full border border-dashed border-primary p-[3px] ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-muted text-sm font-bold uppercase text-foreground">
        {src ? <img src={src} alt={alt} className="h-full w-full object-cover" /> : <span aria-label={alt}>{initials ?? alt.slice(0, 2)}</span>}
      </span>
      {status !== 'none' ? (
        <span
          aria-label={status === 'live' ? 'Live now' : 'Online'}
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background ${status === 'live' ? 'bg-destructive' : 'bg-emerald-500'}`}
        />
      ) : null}
    </span>
  );
}