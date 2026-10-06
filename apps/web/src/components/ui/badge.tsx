import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors gap-1 whitespace-nowrap ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary-solid text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive-solid text-destructive-foreground",
        outline: "text-foreground border-border",
        success: "border-transparent bg-success-solid text-success-foreground",
        warning: "border-transparent bg-warning-solid text-warning-foreground",
        agent: "border-agent-border bg-agent-muted text-agent font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
