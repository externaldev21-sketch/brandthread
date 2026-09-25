import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ProductStatus = "draft" | "active" | "archived";

type PriceTier = {
  id?: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPriceCents: number;
};

type Product = {
  id: string;
  manufacturerId: string;
  name: string;
  description: string | null;
  category: string | null;
  images: string[];
  moq: number;
  leadTimeDays: number;
  samplePriceCents: number | null;
  samplePriceLabel: string | null;
  customizationOptions: string[];
  status: ProductStatus;
  priceTiers: PriceTier[];
  createdAt: string;
  updatedAt: string;
};

type RequestError = Error & { status?: number };

type TierDraft = { minQuantity: string; maxQuantity: string; unitPriceCents: string };

type FormState = {
  name: string;
  description: string;
  category: string;
  moq: string;
  leadTimeDays: string;
  samplePriceCents: string;
  samplePriceLabel: string;
  tiers: TierDraft[];
};

const money = (cents: number | null | undefined) =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const emptyTier = (): TierDraft => ({ minQuantity: "", maxQuantity: "", unitPriceCents: "" });

const emptyForm = (): FormState => ({
  name: "",
  description: "",
  category: "",
  moq: "1",
  leadTimeDays: "",
  samplePriceCents: "",
  samplePriceLabel: "",
  tiers: [emptyTier()],
});

function productToForm(product: Product): FormState {
  return {
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? "",
    moq: String(product.moq ?? 1),
    leadTimeDays: product.leadTimeDays ? String(product.leadTimeDays) : "",
    samplePriceCents: product.samplePriceCents ? (product.samplePriceCents / 100).toFixed(2) : "",
    samplePriceLabel: product.samplePriceLabel ?? "",
    tiers: product.priceTiers.length
      ? product.priceTiers.map((tier) => ({
          minQuantity: String(tier.minQuantity),
          maxQuantity: tier.maxQuantity == null ? "" : String(tier.maxQuantity),
          unitPriceCents: (tier.unitPriceCents / 100).toFixed(2),
        }))
      : [emptyTier()],
  };
}

function StatusBadge({ status }: { status: ProductStatus }) {
  const variant = status === "active" ? "default" : status === "archived" ? "secondary" : "outline";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

export default function Products() {
  const { getToken } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(body?.error || "Product action failed") as RequestError;
      requestError.status = response.status;
      throw requestError;
    }
    return body as T;
  }, [getToken]);

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await request<Product[]>("/api/manufacturers/me/products");
      setProducts(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Products could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm(productToForm(product));
    setFormError("");
    setDialogOpen(true);
  };

  const updateTier = (index: number, patch: Partial<TierDraft>) => {
    setForm((current) => ({
      ...current,
      tiers: current.tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...patch } : tier)),
    }));
  };

  const addTier = () => {
    setForm((current) => ({ ...current, tiers: [...current.tiers, emptyTier()] }));
  };

  const removeTier = (index: number) => {
    setForm((current) => ({
      ...current,
      tiers: current.tiers.length > 1 ? current.tiers.filter((_, tierIndex) => tierIndex !== index) : current.tiers,
    }));
  };

  const buildPayload = (): { error: string } | {
    payload: {
      name: string;
      description: string;
      category: string;
      moq: number;
      leadTimeDays: number;
      samplePriceCents: number;
      samplePriceLabel: string | undefined;
      priceTiers: { minQuantity: number; maxQuantity: number | null; unitPriceCents: number }[];
    };
  } => {
    if (!form.name.trim()) return { error: "Name is required." };
    const moq = Number(form.moq);
    if (!Number.isInteger(moq) || moq < 1) return { error: "MOQ must be a positive whole number." } as const;

    const tiers: { minQuantity: number; maxQuantity: number | null; unitPriceCents: number }[] = [];
    for (const tier of form.tiers) {
      const minQuantity = Number(tier.minQuantity);
      const maxQuantity = tier.maxQuantity.trim() === "" ? null : Number(tier.maxQuantity);
      const unitPrice = Number(tier.unitPriceCents);
      if (!Number.isInteger(minQuantity) || minQuantity < 1) {
        return { error: "Each price tier needs a minimum quantity of at least 1." } as const;
      }
      if (maxQuantity !== null && (!Number.isInteger(maxQuantity) || maxQuantity < minQuantity)) {
        return { error: "A tier's maximum quantity must be at or above its minimum." } as const;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return { error: "Each price tier needs a unit price of 0 or more." } as const;
      }
      tiers.push({ minQuantity, maxQuantity, unitPriceCents: Math.round(unitPrice * 100) });
    }
    if (tiers.length === 0) return { error: "Add at least one price tier." } as const;

    const samplePriceCents = form.samplePriceCents.trim() === "" ? 0 : Math.round(Number(form.samplePriceCents) * 100);
    if (!Number.isFinite(samplePriceCents) || samplePriceCents < 0) {
      return { error: "Sample price must be 0 or more." } as const;
    }

    return {
      payload: {
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category.trim(),
        moq,
        leadTimeDays: form.leadTimeDays.trim() === "" ? 0 : Number(form.leadTimeDays),
        samplePriceCents,
        samplePriceLabel: form.samplePriceLabel.trim() || undefined,
        priceTiers: tiers,
      },
    } as const;
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    const result = buildPayload();
    if ("error" in result) {
      setFormError(result.error);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await request<Product>(`/api/manufacturers/me/products/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(result.payload),
        });
        setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        toast.success("Product updated");
      } else {
        const created = await request<Product>("/api/manufacturers/me/products", {
          method: "POST",
          body: JSON.stringify(result.payload),
        });
        setProducts((current) => [created, ...current]);
        toast.success("Product added to your catalog");
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "This product could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (product: Product, status: ProductStatus) => {
    if (status === product.status) return;
    setStatusUpdatingId(product.id);
    try {
      const updated = await request<Product>(`/api/manufacturers/me/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(`Marked as ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status could not be updated.");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await request<void>(`/api/manufacturers/me/products/${deleteTarget.id}`, { method: "DELETE" });
      setProducts((current) => current.filter((item) => item.id !== deleteTarget.id));
      toast.success("Product deleted");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Product could not be deleted.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-testid="status-loading-products">
        <div className="h-10 w-56 animate-pulse rounded bg-secondary" />
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </div>
    );
  }

  if (error) {
    return <QueryError title="Unable to load your catalog" description={error} onRetry={() => { setLoading(true); void load(); }} />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Catalog</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-muted-foreground">Manage the products sellers can browse, with quantity-based pricing.</p>
        </div>
        <Button className="gap-2 self-start" onClick={openCreate} data-testid="button-add-product">
          <Plus className="h-4 w-4" /> Add product
        </Button>
      </div>

      {products.length === 0 ? (
        <EmptyState icon={Package} title="Your catalog is empty" description="Add your first product with quantity price tiers to get started." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>MOQ</TableHead>
                <TableHead>Price tiers</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                  <TableCell className="max-w-[220px]">
                    <p className="truncate font-medium">{product.name}</p>
                    {product.description && <p className="truncate text-xs text-muted-foreground">{product.description}</p>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{product.category || "—"}</TableCell>
                  <TableCell className="text-sm">{product.moq.toLocaleString()} units</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-col gap-0.5">
                      {product.priceTiers.map((tier) => (
                        <span key={tier.id ?? `${tier.minQuantity}-${tier.maxQuantity}`} className="text-xs text-muted-foreground">
                          {tier.minQuantity.toLocaleString()}{tier.maxQuantity ? `–${tier.maxQuantity.toLocaleString()}` : "+"} · {money(tier.unitPriceCents)}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={product.status}
                      onValueChange={(value) => void changeStatus(product, value as ProductStatus)}
                      disabled={statusUpdatingId === product.id}
                    >
                      <SelectTrigger className="h-8 w-[120px]" data-testid={`select-status-${product.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(product)} data-testid={`button-edit-${product.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(product)}
                        data-testid={`button-delete-${product.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit product" : "Add product"}</DialogTitle>
            <DialogDescription>
              Set your product details and the price per unit at each quantity tier.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="space-y-5">
            {formError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                <X className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="product-name">Name <span className="text-primary">*</span></Label>
                <Input
                  id="product-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Heavyweight cotton hoodie"
                  data-testid="input-product-name"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="product-description">Description</Label>
                <Textarea
                  id="product-description"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Fabric, construction, fit notes..."
                  className="min-h-20 resize-y"
                  data-testid="textarea-product-description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-category">Category</Label>
                <Input
                  id="product-category"
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="e.g. Outerwear"
                  data-testid="input-product-category"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-moq">MOQ (units) <span className="text-primary">*</span></Label>
                <Input
                  id="product-moq"
                  type="number"
                  min="1"
                  value={form.moq}
                  onChange={(event) => setForm((current) => ({ ...current, moq: event.target.value }))}
                  data-testid="input-product-moq"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-lead-time">Lead time (days)</Label>
                <Input
                  id="product-lead-time"
                  type="number"
                  min="0"
                  value={form.leadTimeDays}
                  onChange={(event) => setForm((current) => ({ ...current, leadTimeDays: event.target.value }))}
                  data-testid="input-product-lead-time"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-sample-price">Sample price (USD)</Label>
                <Input
                  id="product-sample-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.samplePriceCents}
                  onChange={(event) => setForm((current) => ({ ...current, samplePriceCents: event.target.value }))}
                  placeholder="0.00"
                  data-testid="input-product-sample-price"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="product-sample-label">Sample price note</Label>
                <Input
                  id="product-sample-label"
                  value={form.samplePriceLabel}
                  onChange={(event) => setForm((current) => ({ ...current, samplePriceLabel: event.target.value }))}
                  placeholder="e.g. Includes shipping"
                  data-testid="input-product-sample-label"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Quantity price tiers <span className="text-primary">*</span></Label>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addTier} data-testid="button-add-tier">
                  <Plus className="h-3.5 w-3.5" /> Add tier
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/3">Min qty</TableHead>
                      <TableHead className="w-1/3">Max qty</TableHead>
                      <TableHead className="w-1/3">Unit price (USD)</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.tiers.map((tier, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={tier.minQuantity}
                            onChange={(event) => updateTier(index, { minQuantity: event.target.value })}
                            className="h-9"
                            data-testid={`input-tier-min-${index}`}
                            required
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={tier.maxQuantity}
                            onChange={(event) => updateTier(index, { maxQuantity: event.target.value })}
                            placeholder="No limit"
                            className="h-9"
                            data-testid={`input-tier-max-${index}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={tier.unitPriceCents}
                            onChange={(event) => updateTier(index, { unitPriceCents: event.target.value })}
                            placeholder="0.00"
                            className="h-9"
                            data-testid={`input-tier-price-${index}`}
                            required
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn("h-9 w-9", form.tiers.length === 1 && "opacity-40")}
                            onClick={() => removeTier(index)}
                            disabled={form.tiers.length === 1}
                            data-testid={`button-remove-tier-${index}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">Leave a tier's max quantity blank for "and above."</p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="gap-2" data-testid="button-save-product">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Add product"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the product and its price tiers from your catalog. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void confirmDelete(); }}
              disabled={deleting}
              className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-product"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
