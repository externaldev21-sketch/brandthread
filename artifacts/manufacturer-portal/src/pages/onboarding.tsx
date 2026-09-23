import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, Handshake, ImagePlus, Loader2, Lock, MessageSquare, Trash2, Wallet,
} from "lucide-react";
import {
  getGetMyManufacturerProfileQueryKey, getResolveManufacturerInviteQueryKey, useGetMyManufacturerProfile,
  useRegisterManufacturer, useRegisterManufacturerViaInvite, useResolveManufacturerInvite,
} from "@workspace/api-client-react";
import { COUNTRIES, findCountry, localTimeLabel } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimeZoneSelect, browserTimeZone } from "@/components/time-zone-select";
import { cn } from "@/lib/utils";
import { errorMessage, useApiRequest } from "@/lib/api";
import { clearInvite, pendingInvite } from "@/lib/invite";

const SPECIALTIES = ["Cut & Sew", "Knitwear", "Denim", "Activewear", "Outerwear", "Swimwear", "Leather Goods", "Wovens", "Accessories", "Screen Printing", "Embroidery"];
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Form = {
  businessName: string; country: string; city: string; specialty: string; yearsInBusiness: string;
  moq: string; priceRange: string; sampleTurnaround: string; bulkTurnaround: string; description: string;
  contactEmail: string; contactPhone: string; website: string; timeZone: string;
};
type Errors = Partial<Record<keyof Form, string>>;

const STEPS = ["Business", "Capabilities", "Contact", "Review", "Photos", "Done"] as const;

function validate(step: number, form: Form): Errors {
  const errors: Errors = {};
  if (step === 0) {
    if (form.businessName.trim().length < 2) errors.businessName = "Enter your registered business name.";
    if (!form.country) errors.country = "Choose the country your factory is in.";
    if (!form.specialty.trim()) errors.specialty = "Pick what you make best.";
    const years = Number(form.yearsInBusiness);
    if (form.yearsInBusiness === "" || !Number.isInteger(years) || years < 0 || years > 200) errors.yearsInBusiness = "Enter a whole number of years (0 if you're new).";
  }
  if (step === 1) {
    const moq = Number(form.moq);
    if (!Number.isInteger(moq) || moq < 1) errors.moq = "Enter your minimum order quantity in pieces.";
    if (!form.priceRange.trim()) errors.priceRange = "Give sellers a price range per piece, e.g. US$8–20.";
    if (!form.sampleTurnaround.trim()) errors.sampleTurnaround = "How long does a sample usually take?";
    if (!form.bulkTurnaround.trim()) errors.bulkTurnaround = "How long does a bulk run usually take?";
    if (form.description.trim().length < 30) errors.description = "Write at least a couple of sentences (30+ characters).";
  }
  if (step === 2) {
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) errors.contactEmail = "Enter a valid email address.";
    if (form.website && !/^https?:\/\/\S+\.\S+/.test(form.website)) errors.website = "Start with https://";
    if (!form.timeZone) errors.timeZone = "Choose your time zone.";
  }
  return errors;
}

function Field({ label, error, children, hint, htmlFor }: { label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const request = useApiRequest();
  const invite = useMemo(() => pendingInvite(), []);
  const me = useGetMyManufacturerProfile({ query: { queryKey: getGetMyManufacturerProfileQueryKey(), retry: false } });
  const inviteInfo = useResolveManufacturerInvite(invite ?? "", {
    query: { queryKey: getResolveManufacturerInviteQueryKey(invite ?? ""), enabled: !!invite, retry: false },
  });
  const register = useRegisterManufacturer();
  const registerViaInvite = useRegisterManufacturerViaInvite();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [form, setForm] = useState<Form>({
    businessName: "", country: "", city: "", specialty: "", yearsInBusiness: "",
    moq: "100", priceRange: "", sampleTurnaround: "", bulkTurnaround: "", description: "",
    contactEmail: "", contactPhone: "", website: "", timeZone: browserTimeZone(),
  });
  const [timeZoneTouched, setTimeZoneTouched] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  useEffect(() => {
    const email = user?.primaryEmailAddress?.emailAddress;
    if (email) setForm((current) => current.contactEmail ? current : { ...current, contactEmail: email });
  }, [user]);
  useEffect(() => {
    const invited = inviteInfo.data;
    if (invited?.companyName) setForm((current) => current.businessName ? current : { ...current, businessName: invited.companyName ?? "" });
  }, [inviteInfo.data]);

  // Already registered: accept a pending invite for the existing profile, or go to the hub.
  const existing = me.data;
  useEffect(() => {
    if (!existing || step >= 4) return;
    if (!invite) { setLocation("/dashboard"); return; }
    if (accepting) return;
    setAccepting(true);
    request<{ threadId?: string }>(`/api/manufacturers/register-via-invite/${encodeURIComponent(invite)}`, { method: "POST", body: "{}" })
      .then((result) => { clearInvite(); setLocation(result.threadId ? `/messages/${result.threadId}` : "/dashboard"); })
      .catch(() => { clearInvite(); setLocation("/dashboard"); });
  }, [existing, invite, step, accepting, request, setLocation]);

  const next = () => {
    const found = validate(step, form);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((current) => current + 1);
  };

  const submit = () => {
    setSubmitError(null);
    const data = {
      businessName: form.businessName.trim(),
      country: form.country,
      city: form.city.trim() || undefined,
      specialty: form.specialty.trim(),
      yearsInBusiness: Number(form.yearsInBusiness),
      moq: Number(form.moq),
      priceRange: form.priceRange.trim(),
      sampleTurnaround: form.sampleTurnaround.trim(),
      bulkTurnaround: form.bulkTurnaround.trim(),
      description: form.description.trim(),
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      website: form.website.trim() || undefined,
      timeZone: form.timeZone,
    };
    const done = (thread?: string | null) => {
      clearInvite();
      setThreadId(thread ?? null);
      void queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
      setStep(4);
    };
    const fail = (error: unknown) => setSubmitError(errorMessage(error, "Your profile couldn't be created. Try again."));
    if (invite && inviteInfo.data) {
      registerViaInvite.mutate({ token: invite, data }, { onSuccess: (result) => done(result.threadId), onError: fail });
    } else {
      register.mutate({ data }, { onSuccess: () => done(null), onError: fail });
    }
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPhotoError(null);
    const chosen = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    for (const file of chosen) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setPhotoError("Use JPEG, PNG or WebP photos."); continue; }
      if (file.size > MAX_PHOTO_BYTES) { setPhotoError(`${file.name} is over 5 MB. Try a smaller photo.`); continue; }
      setUploading((count) => count + 1);
      try {
        const result = await request<{ photos: string[] }>("/api/manufacturers/me/photos", { method: "POST", body: file, headers: { "Content-Type": file.type } });
        setPhotos(result.photos);
      } catch (error) {
        setPhotoError(errorMessage(error, "A photo didn't upload. Try again."));
      } finally {
        setUploading((count) => count - 1);
      }
    }
    void queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
  };

  const removePhoto = async (index: number) => {
    const profile = await queryClient.fetchQuery({ queryKey: getGetMyManufacturerProfileQueryKey(), queryFn: () => request<{ revision: number }>("/api/manufacturers/me"), staleTime: 0 });
    try {
      const updated = await request<{ photos: string[] }>(`/api/manufacturers/me/photos/${index}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: profile.revision }) });
      setPhotos(updated.photos);
      void queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
    } catch (error) {
      setPhotoError(errorMessage(error, "That photo couldn't be removed."));
    }
  };

  const isInvited = !!invite && !!inviteInfo.data;
  const pending = register.isPending || registerViaInvite.isPending;

  if (me.isLoading || (existing && step < 4) || (invite && inviteInfo.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground" data-testid="status-onboarding-loading">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {existing && invite ? "Connecting you with the seller…" : "Loading…"}
      </div>
    );
  }

  const country = findCountry(form.country);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}brandthread-logo.png`} alt="" className="h-8 w-8 rounded-sm object-cover" />
          <span className="text-sm font-semibold uppercase tracking-tight">Manufacturer setup</span>
        </div>
        {isInvited && (
          <span className="hidden items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary sm:flex">
            <Handshake className="h-3.5 w-3.5" /> Invited by {inviteInfo.data?.sellerName}
          </span>
        )}
      </header>

      <div className="flex flex-1">
        <nav className="hidden w-64 shrink-0 border-r border-border bg-card p-6 md:block" aria-label="Setup steps">
          <ol className="space-y-5">
            {STEPS.map((label, index) => (
              <li key={label} className="flex items-center gap-3">
                <span className={cn(
                  "flex h-8 w-8 items-center justify-center rounded border text-sm font-bold",
                  step > index ? "border-primary bg-primary text-primary-foreground" : step === index ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground",
                )}>
                  {step > index ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className={cn("text-sm font-medium", step >= index ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              </li>
            ))}
          </ol>
        </nav>

        <main className="flex-1 overflow-y-auto p-6 pb-32 md:p-12">
          <div className="mx-auto w-full max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500" key={step}>
            <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary md:hidden">Step {step + 1} of {STEPS.length}</p>

            {step === 0 && (
              <section className="space-y-6">
                <div><h1 className="text-2xl font-bold tracking-tight">Your business</h1><p className="mt-1 text-muted-foreground">This is what sellers see first in the directory.</p></div>
                {invite && inviteInfo.isError && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200" role="status" data-testid="status-onboarding-invite-invalid">
                    That invite link can't be used anymore, so you'll be listed in the public directory. Ask the seller for a new link if you want a private profile.
                  </p>
                )}
                <Field label="Business name" error={errors.businessName} htmlFor="businessName">
                  <Input id="businessName" value={form.businessName} onChange={(event) => set("businessName", event.target.value)} placeholder="e.g. Saigon Knit Co." className="h-12 bg-secondary/50" data-testid="input-business-name" />
                </Field>
                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="Country" error={errors.country} htmlFor="country">
                    <Select value={form.country} onValueChange={(value) => { set("country", value); if (!timeZoneTouched) { const zone = findCountry(value)?.timeZone; if (zone) set("timeZone", zone); } }}>
                      <SelectTrigger id="country" className="h-12 bg-secondary/50" data-testid="select-country"><SelectValue placeholder="Where is your factory?" /></SelectTrigger>
                      <SelectContent className="max-h-72">{[...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((item) => <SelectItem key={item.code} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="City" htmlFor="city" hint="Optional">
                    <Input id="city" value={form.city} onChange={(event) => set("city", event.target.value)} placeholder="e.g. Ho Chi Minh City" className="h-12 bg-secondary/50" />
                  </Field>
                </div>
                <Field label="What do you make best?" error={errors.specialty}>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {SPECIALTIES.map((spec) => (
                      <button key={spec} type="button" onClick={() => set("specialty", spec)} className={cn("rounded-full border px-4 py-2 text-sm transition-all active:scale-95", form.specialty === spec ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-muted-foreground hover:border-muted-foreground/50")}>
                        {spec}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Years in business" error={errors.yearsInBusiness} htmlFor="years" hint="Shown on your listing. Brands filter by experience.">
                  <Input id="years" inputMode="numeric" value={form.yearsInBusiness} onChange={(event) => set("yearsInBusiness", event.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 12" className="h-12 max-w-40 bg-secondary/50" data-testid="input-years-in-business" />
                </Field>
              </section>
            )}

            {step === 1 && (
              <section className="space-y-6">
                <div><h1 className="text-2xl font-bold tracking-tight">Capabilities</h1><p className="mt-1 text-muted-foreground">Clear numbers get you better-matched requests.</p></div>
                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="Minimum order quantity (pieces)" error={errors.moq} htmlFor="moq">
                    <Input id="moq" inputMode="numeric" value={form.moq} onChange={(event) => set("moq", event.target.value.replace(/[^\d]/g, ""))} className="h-12 bg-secondary/50" />
                  </Field>
                  <Field label="Typical price per piece (USD)" error={errors.priceRange} htmlFor="priceRange">
                    <Input id="priceRange" value={form.priceRange} onChange={(event) => set("priceRange", event.target.value)} placeholder="e.g. US$8 – 20" className="h-12 bg-secondary/50" />
                  </Field>
                  <Field label="Sample turnaround" error={errors.sampleTurnaround} htmlFor="sampleTurnaround">
                    <Input id="sampleTurnaround" value={form.sampleTurnaround} onChange={(event) => set("sampleTurnaround", event.target.value)} placeholder="e.g. 7–10 days" className="h-12 bg-secondary/50" />
                  </Field>
                  <Field label="Bulk turnaround" error={errors.bulkTurnaround} htmlFor="bulkTurnaround">
                    <Input id="bulkTurnaround" value={form.bulkTurnaround} onChange={(event) => set("bulkTurnaround", event.target.value)} placeholder="e.g. 30–45 days" className="h-12 bg-secondary/50" />
                  </Field>
                </div>
                <Field label="About your factory" error={errors.description} htmlFor="description" hint="Machines, certifications, team size, brands you've produced for.">
                  <Textarea id="description" value={form.description} onChange={(event) => set("description", event.target.value)} className="min-h-[130px] resize-y bg-secondary/50" placeholder="We're a 60-person knitwear factory with 40 flatbed machines…" />
                </Field>
              </section>
            )}

            {step === 2 && (
              <section className="space-y-6">
                <div><h1 className="text-2xl font-bold tracking-tight">Contact & time zone</h1><p className="mt-1 text-muted-foreground">Sellers see your local time so they know when you're likely to reply.</p></div>
                <Field label="Time zone" error={errors.timeZone} htmlFor="timeZone" hint={localTimeLabel(form.timeZone) ?? undefined}>
                  <TimeZoneSelect id="timeZone" value={form.timeZone} onChange={(value) => { setTimeZoneTouched(true); set("timeZone", value); }} />
                </Field>
                <div className="grid gap-6 md:grid-cols-2">
                  <Field label="Business email" error={errors.contactEmail} htmlFor="email">
                    <Input id="email" type="email" value={form.contactEmail} onChange={(event) => set("contactEmail", event.target.value)} className="h-12 bg-secondary/50" />
                  </Field>
                  <Field label="Phone / WhatsApp" htmlFor="phone" hint="Optional. Include your country code.">
                    <Input id="phone" type="tel" value={form.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} placeholder="+84 …" className="h-12 bg-secondary/50" />
                  </Field>
                </div>
                <Field label="Website" error={errors.website} htmlFor="website" hint="Optional">
                  <Input id="website" type="url" value={form.website} onChange={(event) => set("website", event.target.value)} placeholder="https://" className="h-12 bg-secondary/50" />
                </Field>
              </section>
            )}

            {step === 3 && (
              <section className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Review</h1>
                  <p className="mt-1 text-muted-foreground">
                    {isInvited
                      ? `Your profile will be private — only ${inviteInfo.data?.sellerName} can see it.`
                      : "Your listing goes live in the public directory as soon as you confirm. No approval wait."}
                  </p>
                </div>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  <div className="p-4"><p className="text-lg font-semibold">{form.businessName}</p><p className="text-sm text-muted-foreground">{[form.city, form.country].filter(Boolean).join(", ")} · {form.specialty} · {form.yearsInBusiness} {form.yearsInBusiness === "1" ? "year" : "years"} in business</p></div>
                  <div className="grid grid-cols-2 gap-4 p-4 text-sm">
                    <div><p className="text-muted-foreground">MOQ</p><p className="font-medium">{Number(form.moq).toLocaleString("en-US")} pieces</p></div>
                    <div><p className="text-muted-foreground">Price per piece</p><p className="font-medium">{form.priceRange}</p></div>
                    <div><p className="text-muted-foreground">Samples</p><p className="font-medium">{form.sampleTurnaround}</p></div>
                    <div><p className="text-muted-foreground">Bulk</p><p className="font-medium">{form.bulkTurnaround}</p></div>
                  </div>
                  <div className="p-4 text-sm"><p className="text-muted-foreground">Local time</p><p className="font-medium">{localTimeLabel(form.timeZone)}</p></div>
                  <p className="whitespace-pre-wrap p-4 text-sm">{form.description}</p>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                  {isInvited ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  <p>Next you'll add factory photos. {isInvited ? "You can choose to join the public directory later from your profile." : "Listings with photos get far more requests."}</p>
                </div>
                {submitError && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{submitError}</p>}
              </section>
            )}

            {step === 4 && (
              <section className="space-y-6">
                <div><h1 className="text-2xl font-bold tracking-tight">Factory photos</h1><p className="mt-1 text-muted-foreground">Show your floor, machines, finished pieces and packing. Add at least 3; up to {MAX_PHOTOS}. The first photo leads your listing.</p></div>
                <label className={cn("flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-4 text-center text-sm text-muted-foreground hover:border-primary", photos.length >= MAX_PHOTOS && "cursor-not-allowed opacity-60")} data-testid="input-onboarding-photos">
                  {uploading > 0 ? <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" /> : <ImagePlus className="mb-2 h-6 w-6 text-primary" />}
                  <span className="font-medium text-foreground">{uploading > 0 ? `Uploading ${uploading} photo${uploading === 1 ? "" : "s"}…` : photos.length >= MAX_PHOTOS ? "Photo limit reached" : "Choose photos"}</span>
                  <span className="mt-1 text-xs">JPEG, PNG or WebP · up to 5 MB each</span>
                  <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={photos.length >= MAX_PHOTOS || uploading > 0} onChange={(event) => { void uploadPhotos(event.target.files); event.currentTarget.value = ""; }} />
                </label>
                {photoError && <p className="text-sm text-destructive" role="alert">{photoError}</p>}
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {photos.map((photo, index) => (
                      <div key={`${photo}-${index}`} className="group relative overflow-hidden rounded-md border border-border">
                        <img src={photo} alt={`Factory photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                        {index === 0 && <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">Lead photo</span>}
                        <button type="button" onClick={() => void removePhoto(index)} className="absolute right-1.5 top-1.5 rounded bg-background/90 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={`Remove photo ${index + 1}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">{photos.length}/{MAX_PHOTOS} added{photos.length < 3 ? " · You can add more later from your profile." : ""}</p>
              </section>
            )}

            {step === 5 && (
              <section className="space-y-8 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary"><CheckCircle2 className="h-8 w-8" /></div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight" data-testid="text-onboarding-done">{threadId ? `You're connected with ${inviteInfo.data?.sellerName ?? "your seller"}` : "You're live in the directory"}</h1>
                  <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
                    {threadId
                      ? "Your private conversation is ready. Say hello, ask for the tech pack, and send a sample card when you've priced it."
                      : "Brands can find you right now. One last thing: verify your payout account so sellers can pay your order cards."}
                  </p>
                </div>
                <div className="mx-auto grid max-w-lg gap-3 text-left">
                  {threadId && (
                    <Link href={`/messages/${threadId}`} className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4" data-testid="link-onboarding-thread">
                      <MessageSquare className="h-5 w-5 text-primary" /><div className="flex-1"><p className="font-medium">Open the conversation</p><p className="text-sm text-muted-foreground">Chat, share photos and send order cards</p></div><ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  <Link href="/payment" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4" data-testid="link-onboarding-payouts">
                    <Wallet className="h-5 w-5 text-primary" /><div className="flex-1"><p className="font-medium">Set up payouts</p><p className="text-sm text-muted-foreground">About 10 minutes with Stripe{country && country.code !== "US" ? ` · paid out in ${country.currency}` : ""}</p></div><ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/dashboard" className="flex items-center justify-center rounded-lg p-3 text-sm text-muted-foreground hover:text-foreground">Go to my hub</Link>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {step < 5 && (
        <footer className="fixed bottom-0 left-0 right-0 flex items-center justify-between border-t border-border bg-background/80 p-4 backdrop-blur-md md:left-64 md:p-6">
          <Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || step === 4 || pending} className="h-12 gap-2 px-6">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < 3 && <Button onClick={next} className="h-12 gap-2 px-8 font-semibold" data-testid="button-onboarding-next">Continue <ArrowRight className="h-4 w-4" /></Button>}
          {step === 3 && (
            <Button onClick={submit} disabled={pending} className="h-12 gap-2 px-8 font-semibold shadow-lg shadow-primary/20" data-testid="button-onboarding-submit">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {pending ? "Creating profile…" : isInvited ? "Create private profile" : "Go live"}
            </Button>
          )}
          {step === 4 && (
            <Button onClick={() => setStep(5)} disabled={uploading > 0} className="h-12 gap-2 px-8 font-semibold" data-testid="button-onboarding-photos-done">
              {photos.length ? "Finish" : "Skip for now"} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
