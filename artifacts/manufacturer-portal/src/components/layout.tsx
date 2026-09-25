import React from "react";
import { Link, Redirect, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  MessageSquare,
  History,
  Store,
  Settings,
  Factory,
  ShieldAlert,
  FileText,
  Wallet,
  Boxes,
} from "lucide-react";
import { localClock, timeZoneOffsetLabel } from "@workspace/manufacturer-flow";
import { useConnectStatus } from "@/hooks/use-connect-status";
import { cn } from "@/lib/utils";
import { useGetMyManufacturerProfile } from "@workspace/api-client-react";
import { useIsModerator } from "@/hooks/use-ip-cases";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  
  const { data: profile, error: profileError } = useGetMyManufacturerProfile();
  const { data: isModerator } = useIsModerator();
  const connect = useConnectStatus();
  const timeZone = profile?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const navItems: Array<{ href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean; mobile?: string }> = [
    { href: "/dashboard", label: "Hub", icon: LayoutDashboard, mobile: "Hub" },
    { href: "/messages", label: "Inbox", icon: MessageSquare, mobile: "Inbox" },
    { href: "/orders", label: "Active Orders", icon: Package, exact: true, mobile: "Orders" },
    { href: "/orders/history", label: "Completed", icon: History },
    { href: "/payment", label: "Payouts", icon: Wallet, mobile: "Payouts" },
    { href: "/sellers", label: "Sellers", icon: Store },
    { href: "/quote-requests", label: "Quote Requests", icon: FileText },
    { href: "/products", label: "Products", icon: Boxes },
    { href: "/profile", label: "Profile", icon: Settings, mobile: "Profile" },
  ];

  if (isModerator) {
    navItems.push({ href: "/moderation/ip-cases", label: "Safety Queue", icon: ShieldAlert });
  }

  // Signed in but no manufacturer profile yet: finish onboarding first.
  if ((profileError as { status?: number } | null)?.status === 404) return <Redirect to="/onboard" />;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0 z-10">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}brandthread-logo.png`} className="w-8 h-8 rounded-sm object-cover" alt="Brandthread" />
            <span className="font-semibold tracking-tight text-sm uppercase opacity-90">Brandthread</span>
          </div>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto space-y-1">
          <div className="mb-6 px-2">
            <h3 className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-3">Menu</h3>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const isActive = item.exact ? location === item.href : location.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(" ", "-")}`} className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}>
                    <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "opacity-70")} />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/payment" && connect.data && !connect.data.ready && (
                      <span className="h-2 w-2 rounded-full bg-amber-400" aria-label="Payout setup needed" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center text-muted-foreground shrink-0 border border-border">
              <Factory className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {profile?.businessName || "Manufacturer"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {profile?.specialty || "Loading..."}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>
        
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 shrink-0 z-10 sticky top-0">
          <div className="flex items-center md:hidden">
            <img src={`${import.meta.env.BASE_URL}brandthread-logo.png`} className="w-8 h-8 rounded-sm object-cover" alt="Brandthread" />
          </div>
          
          <div className="flex-1"></div>
          
          <div className="flex items-center gap-3">
            {connect.data && !connect.data.ready && (
              <Link href="/payment" className="hidden items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 sm:flex" data-testid="link-header-payout-setup">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Finish payout setup
              </Link>
            )}
            <div className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 font-mono text-xs text-muted-foreground" title={timeZone} data-testid="text-header-local-time">
              {localClock(timeZone)} · {timeZoneOffsetLabel(timeZone)}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 z-10 relative">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </div>
        <nav className="grid grid-cols-5 border-t border-border bg-card md:hidden">
          {navItems.filter((item) => item.mobile).map((item) => {
            const isActive = item.exact ? location === item.href : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("flex flex-col items-center gap-1 px-1 py-2 text-[10px]", isActive ? "text-primary" : "text-muted-foreground")}
                data-testid={`link-mobile-${item.label.toLowerCase().replaceAll(" ", "-")}`}
              >
                <item.icon className="h-4 w-4" />
                <span className="max-w-full truncate">{item.mobile}</span>
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
