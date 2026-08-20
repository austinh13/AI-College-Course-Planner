import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  /** Content shown in the tooltip bubble. */
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

// Dependency-free tooltip: CSS-only show/hide on hover or keyboard
// focus via a named group, no portal needed since usage so far is
// inline within normal document flow.
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-white/10 bg-[#0c1715] px-3 py-2 text-center text-xs leading-snug text-[#f2f5f3] opacity-0 shadow-[0_12px_24px_rgba(0,0,0,0.35)] transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
