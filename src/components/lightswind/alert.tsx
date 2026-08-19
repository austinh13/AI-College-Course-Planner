import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// "error" matches the red tone already used for AcademicHistory's load
// errors; "warning" matches the amber box style already used for
// ReviewStep's shortfall-hours message.
const alertVariants = cva("rounded-2xl border px-4 py-3 text-[0.95rem]", {
  variants: {
    variant: {
      error: "border-[#ff6b57]/30 bg-[#ff6b57]/10 text-[#ffb4a7]",
      warning: "border-[#e87500]/25 bg-[#e87500]/10 text-[#f5d5b2]",
    },
  },
  defaultVariants: {
    variant: "error",
  },
});

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
