import { useGetManufacturerDashboard } from "@workspace/api-client-react";
import { ArrowUpRight, DollarSign, Package, MessageSquare, CheckCircle2, Clock } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data, isLoading, error } = useGetManufacturerDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-secondary rounded animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-secondary rounded border border-border animate-pulse"></div>)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 border border-destructive bg-destructive/10 text-destructive rounded-lg flex flex-col items-center justify-center text-center h-64">
        <p className="font-semibold mb-2">Error loading dashboard</p>
        <p className="text-sm opacity-80">Check console or network connection.</p>
      </div>
    );
  }

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sampling': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'in_production': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case 'shipping': return 'text-purple-500 bg-purple-500/10 border-purple-500/20';
      case 'complete': return 'text-primary bg-primary/10 border-primary/20';
      default: return 'text-muted-foreground bg-secondary border-border';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">Real-time metrics for your production operation.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/orders" className="bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2 rounded text-sm font-medium border border-border transition-colors">
            View All Orders
          </Link>
          <Link href="/messages" className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded text-sm font-medium transition-colors shadow-sm shadow-primary/20">
            Inbox
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <p className="text-sm font-medium text-muted-foreground">Active Orders</p>
            <div className="p-2 bg-secondary rounded">
              <Package className="w-4 h-4 text-foreground" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold tracking-tight">{data.activeOrders}</h3>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <p className="text-sm font-medium text-muted-foreground">Pending Messages</p>
            <div className="p-2 bg-secondary rounded">
              <MessageSquare className="w-4 h-4 text-foreground" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold tracking-tight">{data.pendingMessages}</h3>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
            <div className="p-2 bg-secondary rounded">
              <CheckCircle2 className="w-4 h-4 text-foreground" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold tracking-tight">{formatCurrency(data.totalRevenueCents)}</h3>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <p className="text-sm font-medium text-muted-foreground">Pending Payout</p>
            <div className="p-2 bg-secondary rounded">
              <DollarSign className="w-4 h-4 text-primary" />
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-bold tracking-tight text-primary">{formatCurrency(data.pendingPayoutCents)}</h3>
            <p className="text-xs text-muted-foreground mt-1">In Escrow</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold tracking-tight">Recent Orders</h2>
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            See all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        {(!data.recentOrders || data.recentOrders.length === 0) ? (
          <div className="bg-card border border-border rounded-lg p-12 text-center flex flex-col items-center">
            <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mb-4">
              <Package className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">No orders yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">When buyers place orders or request samples, they will appear here.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/50 border-b border-border text-xs uppercase font-mono tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Buyer</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Value</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recentOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium">{order.orderNumber}</td>
                      <td className="px-4 py-3">{order.buyerName}</td>
                      <td className="px-4 py-3">{order.productType}</td>
                      <td className="px-4 py-3">{order.quantity}</td>
                      <td className="px-4 py-3 font-mono">{formatCurrency(order.totalCents)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border uppercase tracking-wider ${getStatusColor(order.status)}`}>
                          {order.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
