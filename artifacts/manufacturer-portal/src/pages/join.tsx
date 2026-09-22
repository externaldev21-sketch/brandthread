import { useEffect } from "react";
import { Link } from "wouter";
import { Show } from "@clerk/react";
import { AlertCircle, ArrowRight, BadgeCheck, Camera, Handshake, Loader2, Lock, MessageSquare, Wallet } from "lucide-react";
import { getResolveManufacturerInviteQueryKey, useResolveManufacturerInvite } from "@workspace/api-client-react";
import { rememberInvite } from "@/lib/invite";

/**
 * Shareable signup link: /manufacturers/join (public directory listing) or
 * /manufacturers/join?invite=<token> (private, from one seller).
 */
export default function Join() {
  const invite = new URLSearchParams(window.location.search).get("invite");
  const resolved = useResolveManufacturerInvite(invite ?? "", {
    query: { queryKey: getResolveManufacturerInviteQueryKey(invite ?? ""), enabled: !!invite, retry: false },
  });
  useEffect(() => { rememberInvite(invite); }, [invite]);

  const inviteStatus = (resolved.error as { status?: number } | null)?.status;
  const onboardHref = invite ? `/onboard?invite=${encodeURIComponent(invite)}` : "/onboard";

  const steps = invite
    ? [
      { icon: Lock, title: "Private by default", body: "Only the seller who invited you can see your profile. You can join the public directory later." },
      { icon: MessageSquare, title: "One ongoing conversation", body: "Share photos, price samples and bulk orders, and post production updates in one thread." },
      { icon: Wallet, title: "Get paid through Stripe", body: "Sellers pay by card or Apple Pay. Payouts go to your bank in your currency." },
    ]
    : [
      { icon: BadgeCheck, title: "Live in minutes", body: "No approval queue. Your listing appears in the directory as soon as you finish." },
      { icon: Camera, title: "Show your factory", body: "Photos, years in business, MOQ and turnaround — what brands look for first." },
      { icon: Wallet, title: "Get paid through Stripe", body: "Price samples and bulk orders in chat. Sellers pay by card or Apple Pay." },
    ];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6 md:px-10">
        <Link href="/" className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}brandthread-logo.png`} alt="" className="h-8 w-8 rounded-sm object-cover" />
          <span className="text-sm font-semibold uppercase tracking-tight">Brandthread</span>
          <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">MANUFACTURERS</span>
        </Link>
        <Show when="signed-out"><Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link></Show>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-6 py-12 md:flex-row md:items-center md:px-10">
        <section className="flex-1 space-y-6">
          {invite ? (
            resolved.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground" data-testid="status-invite-loading"><Loader2 className="h-4 w-4 animate-spin" /> Checking your invite…</div>
            ) : resolved.data ? (
              <>
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary" data-testid="status-invite-valid">
                  <Handshake className="h-4 w-4" /> Private invite
                </div>
                <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
                  <span className="text-primary">{resolved.data.sellerName}</span> wants to make their collection with {resolved.data.companyName ?? "you"}.
                </h1>
                <p className="max-w-xl text-lg text-muted-foreground">Create your free manufacturer account to start working together on Brandthread.</p>
              </>
            ) : (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6" data-testid="status-invite-invalid">
                <AlertCircle className="mb-3 h-6 w-6 text-destructive" />
                <h1 className="text-2xl font-bold">{inviteStatus === 410 ? "This invite was already used" : "This invite link isn't valid"}</h1>
                <p className="mt-2 text-muted-foreground">
                  {inviteStatus === 410
                    ? "If you accepted it, sign in to continue the conversation. Otherwise ask the seller for a new link."
                    : "It may have been copied incompletely. Ask the seller to send it again, or list your factory in the public directory."}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href="/sign-in" className="rounded-md border border-border px-4 py-2 text-sm font-medium">Sign in</Link>
                  <Link href="/join" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">List my factory publicly</Link>
                </div>
              </div>
            )
          ) : (
            <>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1 font-mono text-xs text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Free for manufacturers
              </div>
              <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">List your factory where new fashion brands look for makers.</h1>
              <p className="max-w-xl text-lg text-muted-foreground">Add your business, photos and experience. You're live in the Brandthread directory the moment you finish.</p>
            </>
          )}

          {(!invite || resolved.data) && (
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Show when="signed-out">
                <Link href="/sign-up" className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 font-semibold text-primary-foreground shadow-lg shadow-primary/20" data-testid="link-join-sign-up">
                  Create free account <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">I already have an account</Link>
              </Show>
              <Show when="signed-in">
                <Link href={onboardHref} className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-6 font-semibold text-primary-foreground shadow-lg shadow-primary/20" data-testid="link-join-continue">
                  {invite ? "Accept invite" : "Continue"} <ArrowRight className="h-4 w-4" />
                </Link>
              </Show>
            </div>
          )}
        </section>

        <aside className="w-full space-y-3 md:w-80">
          {steps.map((step) => (
            <div key={step.title} className="flex gap-4 rounded-lg border border-border bg-card p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary"><step.icon className="h-5 w-5 text-primary" /></div>
              <div><p className="font-medium">{step.title}</p><p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p></div>
            </div>
          ))}
        </aside>
      </main>
    </div>
  );
}
