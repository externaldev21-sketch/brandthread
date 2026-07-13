import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Landing from '@/pages/landing';
import Onboarding from '@/pages/onboarding';
import Dashboard from '@/pages/dashboard';
import Orders from '@/pages/orders';
import Messages from '@/pages/messages';
import MessageThread from '@/pages/message-thread';
import Payment from '@/pages/payment';
import Profile from '@/pages/profile';
import { Layout } from '@/components/layout';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/onboard" component={Onboarding} />
      <Route path="/dashboard">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/orders">
        <Layout><Orders /></Layout>
      </Route>
      <Route path="/messages">
        <Layout><Messages /></Layout>
      </Route>
      <Route path="/messages/:threadId">
        {params => <Layout><MessageThread threadId={params.threadId!} /></Layout>}
      </Route>
      <Route path="/payment">
        <Layout><Payment /></Layout>
      </Route>
      <Route path="/profile">
        <Layout><Profile /></Layout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
