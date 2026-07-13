import { useState } from "react";
import { useGetManufacturerPayment, useSetupManufacturerPayment, getGetManufacturerPaymentQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck, Building, Wallet, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { ManufacturerPayment } from "@workspace/api-client-react";

const formSchema = z.object({
  method: z.enum(["bank_transfer", "paypal", "wise"]),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  bankName: z.string().optional(),
  currency: z.string().min(3, "Currency code required (e.g. USD)"),
  paypalEmail: z.string().email().optional().or(z.literal('')),
  wiseEmail: z.string().email().optional().or(z.literal('')),
}).refine(data => {
  if (data.method === 'bank_transfer') {
    return !!data.accountNumber && !!data.routingNumber && !!data.bankName;
  }
  if (data.method === 'paypal') return !!data.paypalEmail;
  if (data.method === 'wise') return !!data.wiseEmail;
  return true;
}, {
  message: "Required fields missing for selected payment method",
  path: ["method"]
});

type FormValues = z.infer<typeof formSchema>;

export default function Payment() {
  const { data: payment, isLoading } = useGetManufacturerPayment();
  const setupMutation = useSetupManufacturerPayment();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      method: "bank_transfer",
      currency: "USD",
      accountNumber: "",
      routingNumber: "",
      bankName: "",
      paypalEmail: "",
      wiseEmail: ""
    }
  });

  const selectedMethod = form.watch("method");

  const onSubmit = (data: FormValues) => {
    setupMutation.mutate(
      { data: { ...data, accountNumber: data.accountNumber ?? '', routingNumber: data.routingNumber ?? '', bankName: data.bankName ?? '' } },
      {
        onSuccess: (updatedPayment) => {
          toast.success("Payment details saved securely");
          queryClient.setQueryData(getGetManufacturerPaymentQueryKey(), updatedPayment);
          setIsEditing(false);
        },
        onError: () => {
          toast.error("Failed to save payment details");
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 bg-secondary rounded animate-pulse"></div>
        <div className="h-64 bg-card rounded border border-border animate-pulse"></div>
      </div>
    );
  }

  const showForm = !payment?.isSetup || isEditing;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payout Settings</h1>
        <p className="text-muted-foreground mt-1">Manage how you receive funds from completed orders.</p>
      </div>

      {/* Escrow Explainer */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 flex flex-col md:flex-row gap-6 items-start">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-6 h-6 text-primary" />
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-lg text-primary">Secure Escrow Model</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Brandthread holds buyer funds securely in escrow the moment an order is approved. 
            Once you mark the production as <strong>Complete</strong> and provide shipping details, 
            funds are automatically released to your configured payout method. Zero invoice chasing.
          </p>
        </div>
      </div>

      {!showForm ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-6 border-b border-border flex justify-between items-center bg-secondary/30">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-lg">Active Payout Method</h2>
            </div>
            <Button variant="outline" onClick={() => setIsEditing(true)}>Update Details</Button>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <p className="text-sm text-muted-foreground mb-1 font-mono uppercase tracking-wider">Method</p>
                <div className="flex items-center gap-2 font-medium text-lg capitalize">
                  {payment.method === 'bank_transfer' ? <Building className="w-5 h-5 text-muted-foreground" /> : <Wallet className="w-5 h-5 text-muted-foreground" />}
                  {payment.method?.replace('_', ' ')}
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1 font-mono uppercase tracking-wider">Currency</p>
                <p className="font-medium text-lg">{payment.currency}</p>
              </div>
              
              {payment.method === 'bank_transfer' ? (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1 font-mono uppercase tracking-wider">Bank Name</p>
                    <p className="font-medium text-lg">{payment.bankName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1 font-mono uppercase tracking-wider">Account Last 4</p>
                    <div className="flex items-center gap-2 font-mono text-lg">
                      •••• {payment.bankLast4}
                    </div>
                  </div>
                </>
              ) : (
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground mb-1 font-mono uppercase tracking-wider">Account Email</p>
                  <p className="font-medium text-lg flex items-center gap-2">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    [Protected Email Address]
                  </p>
                </div>
              )}
            </div>
            <div className="mt-8 pt-4 border-t border-border/50 text-xs text-muted-foreground">
              Last updated: {payment.setupAt ? new Date(payment.setupAt).toLocaleDateString() : 'Unknown'}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6 md:p-8">
          <div className="mb-8">
            <h2 className="text-xl font-bold">Configure Payouts</h2>
            <p className="text-sm text-muted-foreground mt-1">These details are encrypted and stored securely.</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payout Method</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-12">
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="bank_transfer">Wire / Bank Transfer</SelectItem>
                          <SelectItem value="paypal">PayPal</SelectItem>
                          <SelectItem value="wise">Wise (TransferWise)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Settlement Currency</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-12 uppercase font-mono" placeholder="USD, EUR, GBP..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {selectedMethod === 'bank_transfer' && (
                <div className="space-y-6 animate-in slide-in-from-top-2">
                  <div className="h-px bg-border w-full"></div>
                  <h3 className="font-semibold">Bank Details</h3>
                  
                  <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bank Name</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-12" placeholder="e.g. JPMorgan Chase" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="routingNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Routing Number / SWIFT / BIC</FormLabel>
                          <FormControl>
                            <Input {...field} className="h-12 font-mono" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="accountNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Account Number / IBAN</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" placeholder="••••••••••••" className="h-12 font-mono tracking-widest" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              )}

              {selectedMethod === 'paypal' && (
                <div className="space-y-6 animate-in slide-in-from-top-2">
                  <div className="h-px bg-border w-full"></div>
                  <h3 className="font-semibold">PayPal Details</h3>
                  <FormField
                    control={form.control}
                    name="paypalEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PayPal Email Address</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" className="h-12" placeholder="payments@yourcompany.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {selectedMethod === 'wise' && (
                <div className="space-y-6 animate-in slide-in-from-top-2">
                  <div className="h-px bg-border w-full"></div>
                  <h3 className="font-semibold">Wise Details</h3>
                  <FormField
                    control={form.control}
                    name="wiseEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Wise Account Email</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" className="h-12" placeholder="payments@yourcompany.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="flex gap-4 pt-4">
                {isEditing && (
                  <Button type="button" variant="outline" onClick={() => setIsEditing(false)} className="h-12 px-6">
                    Cancel
                  </Button>
                )}
                <Button type="submit" className="h-12 px-8 flex-1 md:flex-none font-semibold gap-2" disabled={setupMutation.isPending}>
                  <Lock className="w-4 h-4" />
                  {setupMutation.isPending ? "Encrypting & Saving..." : "Save Securely"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}
