import { Check, Circle } from "lucide-react";
import { formatTimestamp } from "@workspace/manufacturer-flow";
import { cn } from "@/lib/utils";
import type { TimelineStep } from "@/lib/order-types";

/**
 * Six-stage production tracker. Times are shown in the viewer's own time zone
 * with an explicit GMT offset, so both sides read the same instant.
 */
export function OrderTimeline({ steps, awaitingPayment, cancelled }: { steps: TimelineStep[]; awaitingPayment?: boolean; cancelled?: boolean }) {
  return (
    <ol className="relative space-y-0" data-testid="order-timeline">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.stage} className="relative flex gap-4 pb-6 last:pb-0" data-testid={`timeline-step-${step.stage}`}>
            {!last && (
              <span
                aria-hidden
                className={cn("absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px", step.state === "done" ? "bg-primary/60" : "bg-border")}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                step.state === "done" && "border-primary bg-primary text-primary-foreground",
                step.state === "current" && "border-primary bg-primary/10 text-primary ring-4 ring-primary/10",
                step.state === "upcoming" && "border-border bg-secondary text-muted-foreground",
              )}
            >
              {step.state === "done" ? <Check className="h-4 w-4" /> : step.state === "current" ? <Circle className="h-2.5 w-2.5 fill-current" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className={cn("font-medium", step.state === "upcoming" && "text-muted-foreground")}>{step.label}</p>
                <p className="font-mono text-xs text-muted-foreground" data-testid={`timeline-time-${step.stage}`}>
                  {step.at ? formatTimestamp(step.at) : step.state === "upcoming" ? "" : "Time not recorded"}
                </p>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {index === 0 && awaitingPayment ? "Waiting for the seller to pay. Production starts after payment." : index === 0 && cancelled ? "Closed before payment." : step.description}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
