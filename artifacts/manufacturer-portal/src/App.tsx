import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { dark } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';

import Landing from '@/pages/landing';
import Onboarding from '@/pages/onboarding';
import Dashboard from '@/pages/dashboard';
import Orders from '@/pages/orders';
import Messages from '@/pages/messages';
import MessageThread from '@/pages/message-thread';
import Payment from '@/pages/payment';
import Profile from '@/pages/profile';
import Reports from '@/pages/reports';
import NotFound from '@/pages/not-found';
import { Layout } from '@/components/layout';

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
    colorPrimary: '#00cc66',
    colorForeground: '#e8f5ee',
    colorMutedForeground: '#6b8f7a',
    colorDanger: '#ef4444',
    colorBackground: '#0d1410',
    colorInput: '#1a2420',
    colorInputForeground: '#e8f5ee',
    colorNeutral: '#2a3830',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '0.375rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'rounded-xl w-[440px] max-w-full overflow-hidden border border-[#2a3830] bg-[#0d1410]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#e8f5ee] font-bold',
    headerSubtitle: 'text-[#6b8f7a]',
    socialButtonsBlockButtonText: 'text-[#e8f5ee]',
    formFieldLabel: 'text-[#a0c4b0] text-sm',
    footerActionLink: 'text-[#00cc66] hover:text-[#00ff80]',
    footerActionText: 'text-[#6b8f7a]',
    dividerText: 'text-[#6b8f7a]',
    identityPreviewEditButton: 'text-[#00cc66]',
    formFieldSuccessText: 'text-[#00cc66]',
    alertText: 'text-[#e8f5ee]',
    logoBox: 'mb-2',
    logoImage: 'h-10 w-auto',
    socialButtonsBlockButton: 'border-[#2a3830] bg-[#1a2420] hover:bg-[#243228] text-[#e8f5ee]',
    formButtonPrimary: 'bg-[#00cc66] hover:bg-[#00b359] text-black font-semibold',
    formFieldInput: 'bg-[#1a2420] border-[#2a3830] text-[#e8f5ee]',
    footerAction: 'border-t border-[#1a2420]',
    dividerLine: 'bg-[#2a3830]',
    alert: 'bg-[#1a2420] border-[#2a3830]',
    otpCodeFieldInput: 'bg-[#1a2420] border-[#2a3830] text-[#e8f5ee]',
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
        forceRedirectUrl={`${basePath}/onboard`}
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

            {/* Onboarding — requires auth */}
            <Route path="/onboard">
              <Protected><Onboarding /></Protected>
            </Route>

            {/* Dashboard routes — all protected */}
            <Route path="/dashboard">
              <Protected><Layout><Dashboard /></Layout></Protected>
            </Route>
            <Route path="/orders">
              <Protected><Layout><Orders /></Layout></Protected>
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
            <Route path="/payment">
              <Protected><Layout><Payment /></Layout></Protected>
            </Route>
            <Route path="/profile">
              <Protected><Layout><Profile /></Layout></Protected>
            </Route>
            <Route path="/reports">
              <Protected><Layout><Reports /></Layout></Protected>
            </Route>

            <Route component={NotFound} />
          </Switch>
          <Toaster />
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
