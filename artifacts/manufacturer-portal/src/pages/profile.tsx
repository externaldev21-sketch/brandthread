import { useGetMyManufacturerProfile, useUpdateMyManufacturerProfile, getGetMyManufacturerProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { Save, Factory, CheckCircle2, Upload, X, MessageSquare, ArrowLeft, ArrowRight, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";

const formSchema = z.object({
  businessName: z.string().min(2),
  country: z.string().min(2),
  city: z.string().min(2),
  specialty: z.string().min(2),
  yearsInBusiness: z.coerce.number().int().min(0),
  moq: z.coerce.number().min(1),
  priceRange: z.string().min(2),
  bulkTurnaround: z.string().min(2),
  sampleTurnaround: z.string().min(2),
  description: z.string().min(10),
  website: z.string().url().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().min(5).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

export default function Profile() {
  const { data: profile, isLoading } = useGetMyManufacturerProfile({
    query: { queryKey: getGetMyManufacturerProfileQueryKey(), refetchOnMount: "always", staleTime: 15_000 },
  });
  const updateMutation = useUpdateMyManufacturerProfile();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const initialized = useRef(false);
  const [photoMutation, setPhotoMutation] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: "",
      country: "",
      city: "",
      specialty: "",
      yearsInBusiness: 0,
      moq: 100,
      priceRange: "",
      bulkTurnaround: "",
      sampleTurnaround: "",
      description: "",
      website: "",
      contactEmail: "",
      contactPhone: "",
    }
  });

  useEffect(() => {
    if (profile && !initialized.current) {
      form.reset({
        businessName: profile.businessName,
        country: profile.country,
        city: profile.city || "",
        specialty: profile.specialty,
        yearsInBusiness: profile.yearsInBusiness || 0,
        moq: profile.moq,
        priceRange: profile.priceRange,
        bulkTurnaround: profile.bulkTurnaround,
        sampleTurnaround: profile.sampleTurnaround,
        description: profile.description || "",
        website: profile.website || "",
        contactEmail: profile.contactEmail || "",
        contactPhone: profile.contactPhone || "",
      });
      initialized.current = true;
    }
  }, [profile, form]);

  const onSubmit = (data: FormValues) => {
    if (!profile?.revision) {
      toast.error("Refresh the profile before saving changes.");
      return;
    }
    updateMutation.mutate(
      { data: { ...data, expectedRevision: profile.revision } },
      {
        onSuccess: (updatedProfile) => {
          toast.success("Profile updated successfully");
          queryClient.setQueryData(getGetMyManufacturerProfileQueryKey(), updatedProfile);
        },
        onError: async (error) => {
          toast.error(error instanceof Error ? error.message : "Failed to update profile");
          initialized.current = false;
          await queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
        }
      }
    );
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      for (const file of Array.from(files).slice(0, 8 - (profile?.photos?.length ?? 0))) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
          throw new Error("Choose JPEG, PNG, or WebP images smaller than 5 MB.");
        }
        const token = await getToken();
        const res = await fetch("/api/manufacturers/me/photos", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type },
          body: file,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Photo upload failed.");
      }
      await queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
      toast.success("Factory photo uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Photo upload failed");
    }
  };

  const reorderPhotos = async (fromIndex: number, toIndex: number) => {
    if (!profile || photoMutation || fromIndex === toIndex) return;
    const photos = profile.photos ?? [];
    const photoOrder = photos.map((_photo, index) => index);
    const [moved] = photoOrder.splice(fromIndex, 1);
    photoOrder.splice(toIndex, 0, moved);
    setPhotoMutation(`reorder-${fromIndex}-${toIndex}`);
    try {
      const token = await getToken();
      const res = await fetch("/api/manufacturers/me/photos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: profile.revision, photoOrder }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Photo order could not be saved.");
      queryClient.setQueryData(getGetMyManufacturerProfileQueryKey(), body);
      toast.success("Factory photo order updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Photo order could not be saved.");
      await queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
    } finally {
      setPhotoMutation(null);
    }
  };

  const deletePhoto = async (photoIndex: number) => {
    if (!profile || photoMutation) return;
    if (!window.confirm("Remove this factory photo from your profile?")) return;
    setPhotoMutation(`delete-${photoIndex}`);
    try {
      const token = await getToken();
      const res = await fetch(`/api/manufacturers/me/photos/${photoIndex}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: profile.revision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Photo could not be removed.");
      queryClient.setQueryData(getGetMyManufacturerProfileQueryKey(), body);
      toast.success("Factory photo removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Photo could not be removed.");
      await queryClient.invalidateQueries({ queryKey: getGetMyManufacturerProfileQueryKey() });
    } finally {
      setPhotoMutation(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="h-10 w-48 bg-secondary rounded animate-pulse"></div>
        <div className="h-[600px] bg-card rounded border border-border animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 shrink-0 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Business Profile</h1>
          <p className="text-muted-foreground mt-1">This is how your factory appears to verified buyers.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/messages">
              <MessageSquare className="w-4 h-4 mr-2" />
              Messages
            </Link>
          </Button>
          <div className="flex items-center gap-2 text-sm font-mono px-3 py-1.5 bg-secondary border border-border rounded text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Status: {profile?.status.toUpperCase()}
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
          
          {/* Basic Info */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2 text-primary font-mono text-sm tracking-wider uppercase">
              <Factory className="w-4 h-4" /> 01. Basic Info
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location / Country</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="specialty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Specialty</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} type="url" placeholder="https://" className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="yearsInBusiness"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Years in Business</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min="0" className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone / WhatsApp</FormLabel>
                    <FormControl>
                      <Input {...field} type="tel" className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2 text-primary font-mono text-sm tracking-wider uppercase">
              <Upload className="w-4 h-4" /> Factory photos
            </div>
            <p className="text-sm text-muted-foreground">Add up to eight JPEG, PNG, or WebP photos. Files stay protected and are shown on your published manufacturer profile. Move the first photo into the lead position.</p>
            <label className={`flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-4 text-sm text-muted-foreground hover:border-primary ${(profile?.photos?.length ?? 0) >= 8 || photoMutation ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <Upload className="mb-2 h-5 w-5" />
              {(profile?.photos?.length ?? 0) >= 8 ? "Photo limit reached" : "Choose production photos"}
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={(profile?.photos?.length ?? 0) >= 8 || !!photoMutation} onChange={(event) => { uploadPhotos(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            {(profile?.photos?.length ?? 0) > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {profile!.photos!.map((photo, index) => (
                  <div key={`${photo}-${index}`} className="group relative overflow-hidden rounded-md border border-border bg-card">
                    <img src={photo.startsWith("/objects/") ? `/api/storage${photo}` : photo} alt={`Factory production ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 p-1.5">
                      <span className="truncate px-1 text-xs font-medium text-foreground">
                        {index === 0 ? "Lead image" : `Photo ${index + 1}`}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Move photo ${index + 1} left`}
                          disabled={index === 0 || !!photoMutation}
                          onClick={() => reorderPhotos(index, index - 1)}
                        >
                          {photoMutation === `reorder-${index}-${index - 1}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Move photo ${index + 1} right`}
                          disabled={index === profile!.photos!.length - 1 || !!photoMutation}
                          onClick={() => reorderPhotos(index, index + 1)}
                        >
                          {photoMutation === `reorder-${index}-${index + 1}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label={`Remove photo ${index + 1}`}
                          disabled={!!photoMutation}
                          onClick={() => deletePhoto(index)}
                        >
                          {photoMutation === `delete-${index}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Capabilities */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2 text-primary font-mono text-sm tracking-wider uppercase">
              <Factory className="w-4 h-4" /> 02. Capabilities
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="moq"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Order Quantity (MOQ)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="priceRange"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price Range Per Unit</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sampleTurnaround"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sample Turnaround Time</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bulkTurnaround"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bulk Turnaround Time</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-11 bg-card border-border" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2 text-primary font-mono text-sm tracking-wider uppercase">
              <Factory className="w-4 h-4" /> 03. About
            </div>
            
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Factory Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      className="min-h-[150px] bg-card border-border resize-y" 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 md:p-6 bg-background/80 backdrop-blur-md border-t border-border flex justify-end z-20">
            <Button 
              type="submit" 
              className="h-12 px-8 font-semibold shadow-lg shadow-primary/20 gap-2"
              disabled={updateMutation.isPending || !form.formState.isDirty}
            >
              <Save className="w-4 h-4" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
