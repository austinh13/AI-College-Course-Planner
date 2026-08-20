import type { ReactNode } from "react";
import { Badge } from "./lightswind/badge";

export default function Eyebrow({ children, boxed = true }: { children: ReactNode; boxed?: boolean }) {
  if (boxed) {
    return (
      <Badge
        variant="warning"
        className="inline-flex w-fit border border-[#e87500]/30 bg-[#e87500]/10 px-2.5 py-1 text-2xs font-medium uppercase tracking-[0.18em] text-[#f5d5b2]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {children}
      </Badge>
    );
  }

  return (
    <p className="m-0 text-sm font-medium uppercase tracking-[0.08em] text-[#e87500]" style={{ fontFamily: "var(--font-mono)" }}>
      {children}
    </p>
  );
}
