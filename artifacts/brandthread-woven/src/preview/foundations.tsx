import { HangTagBadge } from '../components/hang-tag-badge';
import { StitchedAvatar } from '../components/stitched-avatar';
import { ThreadLoader } from '../components/thread-loader';
import { ThreadTabIndicator } from '../components/thread-tab-indicator';
import { WovenDivider } from '../components/woven-divider';

const SWATCHES = [
  ['Blue-violet accent', 'bg-primary'],
  ['Neutral ink', 'bg-foreground'],
  ['Charcoal canvas', 'bg-background border'],
  ['Functional glass', 'bg-card border'],
  ['Live only', 'bg-destructive'],
] as const;

export function OverviewPage() {
  return (
    <div className="space-y-8">
      <section className="relative min-h-[420px] overflow-hidden border border-border bg-card">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_40%,hsl(var(--border)/.45)_40.2%,transparent_40.6%)]" />
        <div className="relative flex min-h-[420px] flex-col justify-between p-7 sm:p-10">
          <HangTagBadge variant="drop">Definitive system</HangTagBadge>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Product / commerce / community</p>
            <h2 className="mt-4 max-w-3xl text-5xl font-bold leading-[0.9] tracking-[-0.035em] sm:text-7xl">
              One system.<br /><span className="text-primary">Every screen.</span>
            </h2>
            <WovenDivider variant="section" label="Brandthread" className="mt-8 max-w-xl" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <div className="border border-border bg-card p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Core primitives</p>
          <div className="mt-7 flex flex-wrap items-center gap-6">
            <StitchedAvatar alt="Brandthread seller" initials="BT" status="live" size={72} />
            <HangTagBadge variant="live">Live drop</HangTagBadge>
            <ThreadLoader compact />
          </div>
        </div>
        <div className="overflow-hidden border border-border bg-card">
          <div className="min-h-36 p-6"><p className="text-3xl font-bold">Navigation stays clear.</p></div>
          <ThreadTabIndicator tabs={[{id:'feed',label:'Thread'},{id:'shop',label:'Discover'},{id:'profile',label:'Profile'}]} activeId="shop" />
        </div>
      </section>
    </div>
  );
}

export function ColorsPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SWATCHES.map(([name, className]) => (
        <div key={name} className="border border-border bg-card p-3">
          <div className={`h-28 ${className}`} />
          <p className="mt-3 text-lg font-bold uppercase">{name}</p>
        </div>
      ))}
      <div className="border border-dashed border-primary bg-card p-5 sm:col-span-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Runtime rule</p>
        <p className="mt-3 max-w-xl text-xl">Blue-violet marks primary actions, selected states, links, and key data. Neutral surfaces never shift hue.</p>
      </div>
    </div>
  );
}

export function FontsPage() {
  return (
    <div className="space-y-6 border border-border bg-card p-7">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Inter / Bold sans hierarchy</p>
      <p className="text-7xl font-bold leading-[.9] tracking-[-.035em]">Build the drop.<br />Own the moment.</p>
      <WovenDivider />
      <p className="max-w-xl text-2xl leading-snug text-muted-foreground">Headlines, section titles, and hero numbers are large, bold, and direct. Supporting metadata stays precise and quiet.</p>
      <p className="text-4xl font-bold">Confidence without visual noise.</p>
    </div>
  );
}

export function LayoutPage() {
  return (
    <div className="space-y-5">
      <section className="grid min-h-[360px] grid-cols-5 grid-rows-2 gap-2">
        <div className="col-span-3 row-span-2 grid place-items-end bg-primary p-6 text-primary-foreground"><b className="text-4xl uppercase">Featured drop</b></div>
        <div className="col-span-2 bg-card p-5"><b className="text-2xl uppercase">Live stream</b></div>
        <div className="col-span-2 bg-muted p-5"><b className="text-2xl uppercase">New arrival</b></div>
      </section>
      <p className="font-mono text-xs uppercase tracking-[.16em] text-muted-foreground">Full-bleed product media / asymmetric editorial rhythm / glass only for functional controls</p>
    </div>
  );
}