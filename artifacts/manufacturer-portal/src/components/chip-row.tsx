import type React from "react";
import { cn } from "@/lib/utils";

/**
 * One horizontal row of chips / tabs / filter pills that scrolls sideways
 * instead of wrapping or clipping on narrow screens.
 *
 * - The scroller bleeds to the screen edge (negative margin matching the
 *   layout gutter) and the row keeps a 16px / 32px inset inside it, so the
 *   first and last chip can scroll fully into view.
 * - No visible scrollbar.
 * - The clicked chip is scrolled into view.
 *
 * `className` styles the scroller (override the bleed when the page gutter
 * differs); every other prop, including `role` and `aria-*`, goes on the row.
 */
export function ChipRow({
  className,
  innerClassName,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { innerClassName?: string }) {
  return (
    <div
      data-chip-row=""
      className={cn(
        "-mx-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] md:-mx-8 [&::-webkit-scrollbar]:hidden",
        className,
      )}
      onClickCapture={(event) => {
        const chip = (event.target as HTMLElement).closest("button, a");
        chip?.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
      }}
    >
      <div className={cn("flex w-max gap-2 px-4 md:px-8", innerClassName)} {...props}>
        {children}
      </div>
    </div>
  );
}
