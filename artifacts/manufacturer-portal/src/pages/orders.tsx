import { useState } from "react";
import { useListManufacturerOrders, useUpdateManufacturerOrderStatus, getListManufacturerOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Package, Search, SlidersHorizontal, ArrowUpRight, Box, ShieldCheck, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ManufacturerOrder } from "@workspace/api-client-react";

export default function Orders() {
  const { data: orders, isLoading } = useListManufacturerOrders();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<ManufacturerOrder | null>(null);
  
  const updateStatusMutation = useUpdateManufacturerOrderStatus();
  const queryClient = useQueryClient();

  const [updateForm, setUpdateForm] = useState({
    status: "",
    trackingNumber: "",
    notes: ""
  });

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

  const filteredOrders = orders?.filter(o => 
    o.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
    o.buyerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.productType.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const handleOpenUpdate = (order: ManufacturerOrder) => {
    setSelectedOrder(order);
    setUpdateForm({
      status: order.status,
      trackingNumber: order.trackingNumber || "",
      notes: order.notes || ""
    });
  };

  const submitUpdate = () => {
    if (!selectedOrder) return;
    
    updateStatusMutation.mutate(
      { 
        orderId: selectedOrder.id, 
        data: {
          status: updateForm.status,
          trackingNumber: updateForm.trackingNumber || undefined,
          notes: updateForm.notes || undefined
        } 
      },
      {
        onSuccess: (updatedOrder) => {
          toast.success("Order status updated");
          // Patch cache
          queryClient.setQueryData(getListManufacturerOrdersQueryKey(), (old: ManufacturerOrder[] | undefined) => 
            old ? old.map(o => o.id === updatedOrder.id ? updatedOrder : o) : old
          );
          setSelectedOrder(null);
        },
        onError: () => {
          toast.error("Failed to update status");
        }
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Order Management</h1>
          <p className="text-muted-foreground mt-1">Track and update production stages.</p>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search order #, buyer, or product..." 
            className="pl-9 h-11 bg-card border-border"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" className="h-11 border-border gap-2">
          <SlidersHorizontal className="w-4 h-4" /> Filter
        </Button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-card rounded border border-border animate-pulse"></div>)}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-16 text-center flex flex-col items-center justify-center flex-1">
            <Package className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No orders found</h3>
            <p className="text-muted-foreground">You don't have any orders matching that search.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-y-auto flex-1">
            <table className="w-full text-sm text-left relative">
              <thead className="bg-secondary/80 border-b border-border text-xs uppercase font-mono tracking-wider text-muted-foreground sticky top-0 z-10 backdrop-blur-sm">
                <tr>
                  <th className="px-6 py-4 font-medium">Order Details</th>
                  <th className="px-6 py-4 font-medium">Product</th>
                  <th className="px-6 py-4 font-medium">Value</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-secondary/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-mono font-medium text-foreground mb-1">{order.orderNumber}</div>
                      <div className="text-muted-foreground">{order.buyerName}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium mb-1">{order.productType}</div>
                      <div className="text-muted-foreground text-xs">
                        Qty: {order.quantity} {order.colorway && `• ${order.colorway}`} {order.size && `• ${order.size}`}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono">
                      {formatCurrency(order.totalCents)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border uppercase tracking-wider ${getStatusColor(order.status)}`}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleOpenUpdate(order)}
                      >
                        Update Status
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        {selectedOrder && (
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Update Order {selectedOrder.orderNumber}</DialogTitle>
              <DialogDescription>
                Change production status and add tracking information.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-6 py-4">
              <div className="flex gap-4 p-4 border border-border bg-secondary/30 rounded-lg">
                <Box className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-sm">{selectedOrder.productType} • {selectedOrder.quantity} units</div>
                  <div className="text-xs text-muted-foreground mt-1">Buyer: {selectedOrder.buyerName}</div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="status">Production Status</Label>
                <Select 
                  value={updateForm.status} 
                  onValueChange={(val) => setUpdateForm(prev => ({...prev, status: val}))}
                >
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sampling">Sampling</SelectItem>
                    <SelectItem value="in_production">In Production</SelectItem>
                    <SelectItem value="shipping">Shipping</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(updateForm.status === 'shipping' || updateForm.status === 'complete' || updateForm.status === 'in_production') && (
                <div className="grid gap-2 animate-in slide-in-from-top-2 duration-300">
                  <Label htmlFor="tracking">Tracking Number (Optional)</Label>
                  <Input 
                    id="tracking" 
                    value={updateForm.trackingNumber}
                    onChange={(e) => setUpdateForm(prev => ({...prev, trackingNumber: e.target.value}))}
                    placeholder="e.g. 1Z9999W99999999999" 
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="notes">Notes for Buyer (Optional)</Label>
                <Textarea 
                  id="notes" 
                  value={updateForm.notes}
                  onChange={(e) => setUpdateForm(prev => ({...prev, notes: e.target.value}))}
                  placeholder="Any context or updates..." 
                  className="min-h-[100px] resize-none"
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedOrder(null)}>Cancel</Button>
              <Button onClick={submitUpdate} disabled={updateStatusMutation.isPending}>
                {updateStatusMutation.isPending ? "Saving..." : "Save Updates"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
