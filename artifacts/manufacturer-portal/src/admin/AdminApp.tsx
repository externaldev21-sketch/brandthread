import { useEffect, useState, type ReactNode } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { Show, useClerk } from "@clerk/react";
import { Activity, Banknote, Cpu, Gift, LayoutDashboard, Megaphone, Menu, ScrollText, ShieldAlert, ShoppingBag, Sparkles, Users } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/not-found";
import { useAdminMe } from "./api";
import "./admin.css";

import OverviewPage from "./pages/overview";
import UsersPage from "./pages/users";
import OrdersPage from "./pages/orders";
import RevenuePage from "./pages/revenue";
import AiSpendPage from "./pages/ai-spend";
import ModerationPage from "./pages/moderation";
import FeaturedPage from "./pages/featured";
import AnnouncementsPage from "./pages/announcements";
import InvitesPage from "./pages/invites";
import PromotionsPage from "./pages/promotions";
import AuditPage from "./pages/audit";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users & sellers", icon: Users },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/revenue", label: "Revenue", icon: Banknote },
  { href: "/admin/ai-spend", label: "AI spend", icon: Cpu },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/promotions", label: "Promoted threads", icon: Sparkles },
  { href: "/admin/featured", label: "Featured", icon: Activity },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/invites", label: "Invite codes", icon: Gift },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="space-y-0.5">
      {NAV.map((item) => {
        const active = item.exact ? location === item.href : location.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate}
            className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm", active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <item.icon className="h-4 w-4" />{item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Shell({ email, children }: { email?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Dialogs and sheets render in a portal on <body>, outside the layout wrapper.
  useEffect(() => {
    document.body.classList.add("admin-theme");
    return () => document.body.classList.remove("admin-theme");
  }, []);
  const { signOut } = useClerk();
  const [location] = useLocation();
  const current = NAV.find((n) => (n.exact ? location === n.href : location.startsWith(n.href)))?.label ?? "Admin";
  const footer = (
    <div className="border-t border-border pt-3 text-xs text-muted-foreground">
      <div className="break-all px-3 py-1">{email}</div>
      <button className="w-full rounded-md px-3 py-2 text-left hover:text-foreground" onClick={() => signOut()}>Sign out</button>
    </div>
  );
  return (
    <div className="admin-theme flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-border p-4 md:flex">
        <div>
          <div className="mb-6 px-2.5 text-sm font-semibold tracking-tight">Brandthread Admin</div>
          <NavList />
        </div>
        {footer}
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-background px-4 md:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <span className="text-sm font-medium">{current}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="admin-theme flex w-72 flex-col justify-between border-border bg-background p-4">
          <div>
            <SheetTitle className="mb-6 px-2.5 text-sm font-semibold">Brandthread Admin</SheetTitle>
            <NavList onNavigate={() => setOpen(false)} />
          </div>
          {footer}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Only mounts (and only calls the API) once Clerk says the viewer is signed in. */
function Gate() {
  const { data, isLoading } = useAdminMe();
  if (isLoading) return <div className="admin-theme" />;
  // Anyone who isn't an admin sees the same page as any unknown URL.
  if (!data?.isAdmin) return <NotFound />;
  return (
    <Shell email={data.email}>
      <Switch>
        <Route path="/admin" component={OverviewPage} />
        <Route path="/admin/users" component={UsersPage} />
        <Route path="/admin/orders" component={OrdersPage} />
        <Route path="/admin/revenue" component={RevenuePage} />
        <Route path="/admin/ai-spend" component={AiSpendPage} />
        <Route path="/admin/moderation" component={ModerationPage} />
        <Route path="/admin/promotions" component={PromotionsPage} />
        <Route path="/admin/featured" component={FeaturedPage} />
        <Route path="/admin/announcements" component={AnnouncementsPage} />
        <Route path="/admin/invites" component={InvitesPage} />
        <Route path="/admin/audit" component={AuditPage} />
        <Route><Redirect to="/admin" /></Route>
      </Switch>
    </Shell>
  );
}

export default function AdminApp() {
  return (
    <>
      <Show when="signed-in"><Gate /></Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}
