import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils.js";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onCloseAutoFocus, ...props }, ref) => {
  // Most dialogs here are rendered as `<Dialog open>` without a DialogTrigger, so Radix has no
  // trigger to refocus on close and focus falls to <body>. Remember what had focus when the
  // dialog mounted (the initializer runs before Radix moves focus) and return it there (FR-007).
  const [returnFocusTo] = React.useState(() => {
    if (typeof document === "undefined") return null;
    const active = document.activeElement as HTMLElement | null;
    // Opened from a dropdown item: that item unmounts, so return to the menu's trigger instead.
    const menu = active?.closest<HTMLElement>('[role="menu"]');
    if (menu?.id) {
      return (
        document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`) ?? active
      );
    }
    return active;
  });

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          if (returnFocusTo?.isConnected && returnFocusTo !== document.body) {
            event.preventDefault();
            returnFocusTo.focus();
          }
        }}
        className={cn(
          "fixed z-50 grid w-full gap-4 border border-border bg-popover text-popover-foreground p-6 shadow-raised duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          // Mobile bottom sheet (<640px) sliding up; centered, zooming dialog on sm+.
          "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))] max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-6 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none pointer-coarse:h-11 pointer-coarse:w-11">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pr-8 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground leading-relaxed", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
