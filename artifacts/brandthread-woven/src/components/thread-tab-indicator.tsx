import type { ReactNode } from 'react';

export type ThreadTab = { id: string; label: string; icon?: ReactNode };
export type ThreadTabIndicatorProps = {
  tabs: ThreadTab[];
  activeId: string;
  onChange?: (id: string) => void;
  className?: string;
};

export function ThreadTabIndicator({ tabs, activeId, onChange, className = '' }: ThreadTabIndicatorProps) {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));
  const width = 100 / Math.max(1, tabs.length);
  return (
    <div className={`relative grid border-t border-border bg-card/90 pt-2 ${className}`} style={{ gridTemplateColumns: `repeat(${tabs.length},minmax(0,1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute top-0 h-px bg-primary shadow-[0_0_9px_hsl(var(--primary))] transition-transform duration-300 motion-reduce:transition-none"
        style={{ width: `${width}%`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(tab.id)}
            className={`min-h-11 px-2 font-medium uppercase tracking-[0.08em] transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab.icon}
            <span className="block text-xs">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}