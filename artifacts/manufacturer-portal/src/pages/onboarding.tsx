import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Factory, Image as ImageIcon, Upload } from "lucide-react";

import { useRegisterManufacturer } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const specialties = ["Cut & Sew", "Knitwear", "Denim", "Activewear", "Leather Goods", "Wovens", "Accessories"];

const formSchema = z.object({
  businessName: z.string().min(2, "Business name is required"),
  country: z.string().min(2, "Country is required"),
  specialty: z.string().min(2, "Specialty is required"),
  moq: z.coerce.number().min(1, "MOQ is required"),
  priceRange: z.string().min(2, "Price range is required"),
  bulkTurnaround: z.string().min(2, "Bulk turnaround is required"),
  sampleTurnaround: z.string().min(2, "Sample turnaround is required"),
  description: z.string().min(10, "Description is required"),
  photos: z.array(z.string()).min(1, "At least one photo is required"),
});

type FormValues = z.infer<typeof formSchema>;

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const registerMutation = useRegisterManufacturer();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: "",
      country: "",
      specialty: "",
      moq: 100,
      priceRange: "$10 - $50",
      bulkTurnaround: "30-45 days",
      sampleTurnaround: "10-14 days",
      description: "",
      photos: [],
    },
    mode: "onChange"
  });

  const nextStep = async () => {
    let valid = false;
    if (step === 1) {
      valid = await form.trigger(["businessName", "country", "specialty"]);
    } else if (step === 2) {
      valid = await form.trigger(["moq", "priceRange", "bulkTurnaround", "sampleTurnaround", "description"]);
    } else if (step === 3) {
      valid = await form.trigger(["photos"]);
    }
    
    if (valid) {
      setStep((s) => s + 1);
    }
  };

  const prevStep = () => {
    setStep((s) => Math.max(1, s - 1));
  };

  const onSubmit = (data: FormValues) => {
    registerMutation.mutate(
      { data },
      {
        onSuccess: () => {
          toast.success("Account created successfully");
          setLocation("/dashboard");
        },
        onError: () => {
          toast.error("Failed to create account. Please try again.");
        }
      }
    );
  };

  const currentValues = form.getValues();

  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <header className="h-16 border-b border-border flex items-center px-6 shrink-0 z-10 sticky top-0 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary text-primary-foreground rounded-sm flex items-center justify-center font-bold tracking-tighter">
            B
          </div>
          <span className="font-semibold tracking-tight text-sm uppercase opacity-90">Brandthread Setup</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Progress Sidebar */}
        <div className="hidden md:block w-64 border-r border-border bg-card p-6">
          <div className="space-y-6">
            {[
              { num: 1, label: "Business Details" },
              { num: 2, label: "Capabilities" },
              { num: 3, label: "Facility Photos" },
              { num: 4, label: "Review & Submit" }
            ].map((s) => (
              <div key={s.num} className="flex items-start gap-4">
                <div className={cn(
                  "w-8 h-8 rounded flex items-center justify-center shrink-0 border text-sm font-bold transition-colors duration-300",
                  step > s.num ? "bg-primary text-primary-foreground border-primary" : 
                  step === s.num ? "border-primary text-primary bg-primary/10" : 
                  "border-border text-muted-foreground bg-secondary"
                )}>
                  {step > s.num ? <Check className="w-4 h-4" /> : s.num}
                </div>
                <div className="pt-1.5">
                  <p className={cn(
                    "text-sm font-medium",
                    step >= s.num ? "text-foreground" : "text-muted-foreground"
                  )}>{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-12 relative">
          <div className="max-w-2xl mx-auto w-full pb-24">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {step === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Business Details</h2>
                      <p className="text-muted-foreground mt-1">Basic information about your manufacturing company.</p>
                    </div>

                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="businessName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Business Name</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Acme Garments Ltd." {...field} className="h-12 bg-secondary/50" />
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
                            <FormLabel>Location (Country)</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-12 bg-secondary/50">
                                  <SelectValue placeholder="Select country" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="China">China</SelectItem>
                                <SelectItem value="Vietnam">Vietnam</SelectItem>
                                <SelectItem value="India">India</SelectItem>
                                <SelectItem value="Bangladesh">Bangladesh</SelectItem>
                                <SelectItem value="Turkey">Turkey</SelectItem>
                                <SelectItem value="Italy">Italy</SelectItem>
                                <SelectItem value="Portugal">Portugal</SelectItem>
                                <SelectItem value="Mexico">Mexico</SelectItem>
                                <SelectItem value="United States">United States</SelectItem>
                                <SelectItem value="Peru">Peru</SelectItem>
                              </SelectContent>
                            </Select>
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
                              <div className="flex flex-wrap gap-2 pt-2">
                                {specialties.map(spec => (
                                  <button
                                    key={spec}
                                    type="button"
                                    onClick={() => field.onChange(spec)}
                                    className={cn(
                                      "px-4 py-2 rounded-full border text-sm transition-all active:scale-95",
                                      field.value === spec 
                                        ? "bg-primary text-primary-foreground border-primary" 
                                        : "bg-secondary border-border text-muted-foreground hover:border-muted-foreground/50"
                                    )}
                                  >
                                    {spec}
                                  </button>
                                ))}
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Capabilities</h2>
                      <p className="text-muted-foreground mt-1">What can you produce and how fast?</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="moq"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Minimum Order Quantity (MOQ)</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} className="h-12 bg-secondary/50" />
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
                            <FormLabel>Avg. Price Range Per Unit</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. $12 - $25" {...field} className="h-12 bg-secondary/50" />
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
                              <Input placeholder="e.g. 10-14 days" {...field} className="h-12 bg-secondary/50" />
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
                              <Input placeholder="e.g. 45-60 days" {...field} className="h-12 bg-secondary/50" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Factory Description</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Describe your facility, certifications, machinery, and expertise..." 
                              className="min-h-[120px] bg-secondary/50 resize-y"
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Facility Photos</h2>
                      <p className="text-muted-foreground mt-1">Upload photos of your production floor and past work.</p>
                    </div>

                    <FormField
                      control={form.control}
                      name="photos"
                      render={({ field }) => (
                        <FormItem>
                          <div className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:bg-secondary/50 transition-colors cursor-pointer"
                               onClick={() => {
                                 // Mock file upload
                                 const current = field.value || [];
                                 field.onChange([...current, `https://api.dicebear.com/7.x/shapes/svg?seed=${Date.now()}`]);
                               }}>
                            <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
                            <h3 className="font-semibold mb-1">Click to upload photos</h3>
                            <p className="text-sm text-muted-foreground">Supports JPG, PNG up to 10MB</p>
                          </div>
                          
                          {field.value?.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                              {field.value.map((url, i) => (
                                <div key={i} className="aspect-square bg-secondary rounded border border-border overflow-hidden relative group">
                                  <img src={url} alt={`Factory ${i}`} className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      field.onChange(field.value.filter((_, index) => index !== i));
                                    }}
                                    className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-xs w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    &times;
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Review Details</h2>
                      <p className="text-muted-foreground mt-1">Please confirm your information before submitting.</p>
                    </div>

                    <div className="border border-border bg-card rounded-lg overflow-hidden divide-y divide-border">
                      <div className="p-4 flex gap-4">
                        <div className="w-16 text-muted-foreground font-mono text-xs uppercase tracking-wider mt-1">Company</div>
                        <div className="flex-1">
                          <p className="font-semibold text-lg">{currentValues.businessName}</p>
                          <p className="text-muted-foreground">{currentValues.country} &bull; {currentValues.specialty}</p>
                        </div>
                      </div>
                      
                      <div className="p-4 flex gap-4">
                        <div className="w-16 text-muted-foreground font-mono text-xs uppercase tracking-wider mt-1">Scope</div>
                        <div className="flex-1 grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground">MOQ</p>
                            <p className="font-medium">{currentValues.moq} units</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Price Range</p>
                            <p className="font-medium">{currentValues.priceRange}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Sample Time</p>
                            <p className="font-medium">{currentValues.sampleTurnaround}</p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Bulk Time</p>
                            <p className="font-medium">{currentValues.bulkTurnaround}</p>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 flex gap-4">
                        <div className="w-16 text-muted-foreground font-mono text-xs uppercase tracking-wider mt-1">About</div>
                        <div className="flex-1">
                          <p className="text-sm whitespace-pre-wrap">{currentValues.description}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </form>
            </Form>
          </div>
          
          {/* Sticky footer with buttons */}
          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-6 bg-background/80 backdrop-blur-md border-t border-border flex items-center justify-between">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={step === 1 || registerMutation.isPending}
              className="gap-2 border-border h-12 px-6"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            
            {step < 4 ? (
              <Button onClick={nextStep} className="gap-2 h-12 px-8 font-semibold">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button 
                onClick={form.handleSubmit(onSubmit)} 
                disabled={registerMutation.isPending}
                className="gap-2 h-12 px-8 font-semibold shadow-lg shadow-primary/20"
              >
                {registerMutation.isPending ? "Submitting..." : "Submit Profile"} <Check className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
