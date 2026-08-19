import * as React from "react";
import { cn } from "@/lib/utils";

export interface HoverCardProps {
  /** The element that opens the card on hover/focus — typically a link. */
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  openDelay?: number;
  closeDelay?: number;
}

// Dependency-free hover card: opens after a short delay on hover/focus
// of the trigger, and stays open while the pointer is over the card
// itself so its contents (e.g. a link) stay clickable.
export function HoverCard({ trigger, children, className, openDelay = 150, closeDelay = 150 }: HoverCardProps) {
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<number | null>(null);
  const closeTimer = React.useRef<number | null>(null);

  function show() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), openDelay);
  }
  function hide() {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), closeDelay);
  }

  React.useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    []
  );

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {trigger}
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-60 rounded-2xl border border-white/10 bg-[#0d1b18] p-3.5 text-left shadow-[0_18px_36px_rgba(0,0,0,0.4)]"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {children}
        </div>
      )}
    </span>
  );
}
