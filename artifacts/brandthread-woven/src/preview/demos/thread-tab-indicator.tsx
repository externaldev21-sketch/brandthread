import { useState } from 'react';
import { ThreadTabIndicator } from '../../components/thread-tab-indicator';

const tabs = [
  { id: 'thread', label: 'Thread' },
  { id: 'discover', label: 'Discover' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'profile', label: 'Profile' },
];

export function ThreadTabIndicatorDemo() {
  const [active, setActive] = useState('discover');
  return <div className="max-w-xl overflow-hidden border border-border bg-background">
    <div className="grid min-h-52 place-items-center bg-[radial-gradient(circle_at_70%_30%,hsl(var(--primary)/.16),transparent_45%)]">
      <p className="text-3xl font-extrabold uppercase tracking-tight">Pull toward what’s next.</p>
    </div>
    <ThreadTabIndicator tabs={tabs} activeId={active} onChange={setActive} />
  </div>;
}