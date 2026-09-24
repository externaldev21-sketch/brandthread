import { Link } from "wouter";
import { ArrowRight, Factory, Globe2, ShieldCheck, Zap } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col relative overflow-hidden">
      {/* Background Noise */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" 
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}
      ></div>

      <header className="h-20 border-b border-border px-8 flex items-center justify-between z-10 shrink-0 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary text-primary-foreground rounded flex items-center justify-center font-bold tracking-tighter text-xl">
            B
          </div>
          <span className="font-semibold tracking-tight uppercase opacity-90">Brandthread</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-secondary text-muted-foreground border border-border ml-2">MANUFACTURERS</span>
        </div>
        <div>
          <div className="flex items-center gap-6">
            <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link href="/join" className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-2">
              List your factory <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8 z-10">
        <div className="max-w-4xl w-full text-center space-y-8">
          <div className="inline-flex items-center gap-2 border border-border bg-secondary/50 px-4 py-2 rounded-full text-sm font-mono mb-4 text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            Manufacturer Network Open
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[1.1] text-foreground">
            The supply side of <br />
            <span className="text-primary">next-generation brands.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Get found by new fashion brands, price samples and bulk orders right in
            the chat, update production as you go, and get paid to your bank
            through Stripe — wherever your factory is.
          </p>
          
          <div className="pt-8">
            <Link 
              href="/join" 
              className="inline-flex items-center justify-center gap-3 h-14 px-8 rounded bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 active:scale-[0.98]"
            >
              List your factory — free <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full mt-24">
          <div className="p-6 border border-border bg-card rounded-lg flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 bg-secondary border border-border rounded flex items-center justify-center">
              <Globe2 className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Get discovered</h3>
            <p className="text-sm text-muted-foreground">Your listing goes live the moment you finish signing up — photos, years in business, MOQ and turnaround.</p>
          </div>
          <div className="p-6 border border-border bg-card rounded-lg flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 bg-secondary border border-border rounded flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">One thread per brand</h3>
            <p className="text-sm text-muted-foreground">Chat, share photos, send priced sample and bulk cards, and update each production stage.</p>
          </div>
          <div className="p-6 border border-border bg-card rounded-lg flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 bg-secondary border border-border rounded flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Paid through Stripe</h3>
            <p className="text-sm text-muted-foreground">Sellers pay by card or Apple Pay. Stripe pays out to your bank in your local currency.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
