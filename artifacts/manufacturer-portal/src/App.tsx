import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { dark } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';

import Landing from '@/pages/landing';
import Onboarding from '@/pages/onboarding';
import Join from '@/pages/join';
import Dashboard from '@/pages/dashboard';
import Orders from '@/pages/orders';
import Messages from '@/pages/messages';
import IpCases from '@/pages/moderation/ip-cases';
import MessageThread from '@/pages/message-thread';
import Payment from '@/pages/payment';
import Profile from '@/pages/profile';
import Reports from '@/pages/reports';
import Sellers from '@/pages/sellers';
import OrderTracker from '@/pages/order-tracker';
import QuoteRequests from '@/pages/quote-requests';
import Products from '@/pages/products';
import NotFound from '@/pages/not-found';
import { Layout } from '@/components/layout';
import { useIsModerator } from '@/hooks/use-ip-cases';

// ── Clerk setup ────────────────────────────────────────────────────────────────

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

// REQUIRED — copy verbatim. Empty in dev (intentional), auto-set in prod.
// Do NOT gate on import.meta.env.PROD — breaks prod proxy.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Clerk passes full paths; wouter's setLocation prepends base — strip to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: '#d9d9d9',
    colorForeground: '#f5f5f5',
    colorMutedForeground: '#9a9a9a',
    colorDanger: '#ef4444',
    colorBackground: '#0a0a0a',
    colorInput: '#1a1a1a',
    colorInputForeground: '#f5f5f5',
    colorNeutral: '#2a2a2a',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '0.25rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'rounded-xl w-[440px] max-w-full overflow-hidden border border-[#2a2a2a] bg-[#0a0a0a]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#f5f5f5] font-bold',
    headerSubtitle: 'text-[#9a9a9a]',
    socialButtonsBlockButtonText: 'text-[#f5f5f5]',
    formFieldLabel: 'text-[#c0c0c0] text-sm',
    footerActionLink: 'text-[#d9d9d9] hover:text-[#ffffff]',
    footerActionText: 'text-[#9a9a9a]',
    dividerText: 'text-[#9a9a9a]',
    identityPreviewEditButton: 'text-[#d9d9d9]',
    formFieldSuccessText: 'text-[#d9d9d9]',
    alertText: 'text-[#f5f5f5]',
    logoBox: 'mb-2',
    logoImage: 'h-10 w-auto',
    socialButtonsBlockButton: 'border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#242424] text-[#f5f5f5]',
    formButtonPrimary: 'bg-[#d9d9d9] hover:bg-[#ffffff] text-black font-semibold',
    formFieldInput: 'bg-[#1a1a1a] border-[#2a2a2a] text-[#f5f5f5]',
    footerAction: 'border-t border-[#1a1a1a]',
    dividerLine: 'bg-[#2a2a2a]',
    alert: 'bg-[#1a1a1a] border-[#2a2a2a]',
    otpCodeFieldInput: 'bg-[#1a1a1a] border-[#2a2a2a] text-[#f5f5f5]',
    formFieldRow: '',
    main: '',
  },
};

// ── Query client ───────────────────────────────────────────────────────────────

const queryClient = new QueryClient();

// ── Auth pages ────────────────────────────────────────────────────────────────

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        forceRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/onboard`}
      />
    </div>
  );
}

// ── Auth guard for protected routes ───────────────────────────────────────────

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function ModeratorProtected({ children }: { children: React.ReactNode }) {
  const { data: isModerator, isLoading } = useIsModerator();

  if (isLoading) {
    return <div className="min-h-screen bg-background" data-testid="status-moderator-check" />;
  }

  return isModerator ? children : <Redirect to="/dashboard" />;
}

// ── Home redirect ─────────────────────────────────────────────────────────────

function HomeRedirect() {
  const { isLoaded } = useUser();
  return (
    <>
      <Show when="signed-in">
        {isLoaded && <Redirect to="/dashboard" />}
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

// ── Cache invalidator ─────────────────────────────────────────────────────────

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const uid = user?.id ?? null;
      if (prevRef.current !== undefined && prevRef.current !== uid) qc.clear();
      prevRef.current = uid;
    });
    return unsub;
  }, [addListener, qc]);

  return null;
}

// ── Router ────────────────────────────────────────────────────────────────────

function AppRouter() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      afterSignOutUrl={basePath || '/'}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to your manufacturer account',
          },
        },
        signUp: {
          start: {
            title: 'Create your account',
            subtitle: 'Join the Brandthread manufacturer network',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />

            {/* Auth routes — MUST be exactly /*? */}
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />

            {/* Shareable signup link (public listing or ?invite=<token>) */}
            <Route path="/join" component={Join} />

            {/* Onboarding — requires auth */}
            <Route path="/onboard">
              <Protected><Onboarding /></Protected>
            </Route>

            {/* Dashboard routes — all protected */}
            <Route path="/dashboard">
              <Protected><Layout><Dashboard /></Layout></Protected>
            </Route>
            <Route path="/orders">
              <Protected><Layout><Orders view="active" /></Layout></Protected>
            </Route>
            <Route path="/orders/history">
              <Protected><Layout><Orders view="history" /></Layout></Protected>
            </Route>
            <Route path="/orders/:orderId">
              {(params) => <Protected><Layout><OrderTracker orderId={params.orderId!} /></Layout></Protected>}
            </Route>
            <Route path="/sellers">
              <Protected><Layout><Sellers /></Layout></Protected>
            </Route>
            <Route path="/messages">
              <Protected><Layout><Messages /></Layout></Protected>
            </Route>
            <Route path="/messages/:threadId">
              {(params) => (
                <Protected>
                  <Layout><MessageThread threadId={params.threadId!} /></Layout>
                </Protected>
              )}
            </Route>
            <Route path="/quote-requests">
              <Protected><Layout><QuoteRequests /></Layout></Protected>
            </Route>
            <Route path="/products">
              <Protected><Layout><Products /></Layout></Protected>
            </Route>
            <Route path="/payment">
              <Protected><Layout><Payment /></Layout></Protected>
            </Route>
            <Route path="/profile">
              <Protected><Layout><Profile /></Layout></Protected>
            </Route>
            <Route path="/reports">
              <Protected><Layout><Reports /></Layout></Protected>
            </Route>
            <Route path="/moderation/ip-cases">
              <Protected><ModeratorProtected><Layout><IpCases /></Layout></ModeratorProtected></Protected>
            </Route>

            <Route component={NotFound} />
          </Switch>
          <Toaster />
          <SonnerToaster theme="dark" position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRouter />
    </WouterRouter>
  );
}

export default App;
