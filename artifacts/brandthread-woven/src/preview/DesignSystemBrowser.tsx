import { Suspense, useEffect, useMemo, useState } from 'react';
import { ALL_ENTRIES, DESIGN_SYSTEM, NAV_GROUPS, OVERVIEW_ENTRY } from './registry';
import { ThreadLoader } from '../components/thread-loader';
import { WovenDivider } from '../components/woven-divider';

function hashId() {
  const id = new URLSearchParams(window.location.hash.slice(1)).get('page');
  return ALL_ENTRIES.some((entry) => entry.id === id) ? id! : OVERVIEW_ENTRY.id;
}

export function DesignSystemBrowser() {
  const [selected, setSelected] = useState(hashId);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onHash = () => setSelected(hashId());
    window.addEventListener('hashchange', onHash);
    document.documentElement.classList.add('dark');
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const active = ALL_ENTRIES.find((entry) => entry.id === selected) ?? OVERVIEW_ENTRY;
  const groups = useMemo(() => NAV_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(query.toLowerCase())),
  })).filter((group) => group.entries.length), [query]);
  const choose = (id: string) => { window.location.hash = new URLSearchParams({ page: id }).toString(); setSelected(id); };
  const Page = active.Page;

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-sidebar md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="p-6">
          <p className="text-2xl font-extrabold uppercase tracking-[-.02em]">{DESIGN_SYSTEM.title}</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-primary">The definitive thread</p>
        </div>
        <WovenDivider className="px-5" />
        <div className="p-5">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the system" className="min-h-11 w-full border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary" />
        </div>
        <nav className="max-h-[calc(100vh-170px)] overflow-auto px-5 pb-8" aria-label="Design system">
          <button type="button" onClick={() => choose('overview')} aria-current={selected === 'overview'} className="min-h-11 w-full border-l border-border px-3 text-left font-bold uppercase aria-[current=true]:border-primary aria-[current=true]:text-primary">Overview</button>
          {groups.map((group) => <div key={group.name} className="mt-6">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">{group.name}</p>
            {group.entries.map((entry) => <button key={entry.id} type="button" onClick={() => choose(entry.id)} aria-current={selected === entry.id} className="min-h-10 w-full border-l border-border px-3 text-left text-sm uppercase tracking-[.05em] transition-colors hover:text-primary aria-[current=true]:border-primary aria-[current=true]:font-bold aria-[current=true]:text-primary">{entry.name}</button>)}
          </div>)}
        </nav>
      </aside>
      <main className="min-w-0 px-5 py-8 sm:px-9 lg:px-14">
        <div className="mx-auto max-w-6xl">
          <header className="mb-8">
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Brandthread / Woven system</p>
            <h1 className="mt-2 text-4xl font-extrabold uppercase tracking-[-.025em] sm:text-6xl">{active.name}</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{active.description}</p>
            <WovenDivider variant="section" className="mt-6" />
          </header>
          <Suspense fallback={<ThreadLoader label="Threading preview" />}><Page /></Suspense>
        </div>
      </main>
    </div>
  );
}