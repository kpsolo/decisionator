import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils.js";

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
  /** Classes for the wrapper; `className` styles the <select> itself. */
  wrapperClassName?: string;
}

/**
 * Token-styled native <select>. Native keeps the OS picker on touch devices and full
 * keyboard/screen-reader support without a custom listbox.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, hasError, children, ...props }, ref) => (
    <div className={cn("relative inline-flex", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          "h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-base text-foreground shadow-xs transition-[color,box-shadow,border-color] sm:text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 pointer-coarse:min-h-11",
          hasError && "border-destructive focus-visible:ring-destructive",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  )
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
