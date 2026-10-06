import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "../../lib/utils.js";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        "z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-raised outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

export interface HoverPopoverProps {
  /** The trigger element (rendered via asChild, so pass a focusable element such as a button). */
  trigger: React.ReactElement;
  children: React.ReactNode;
  contentClassName?: string;
  side?: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>["side"];
  align?: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>["align"];
}

/**
 * Popover that opens on mouse hover (with intent delays) and on click/tap/Enter, so secondary
 * content can stay out of the way without becoming unreachable on touch or keyboard.
 */
function HoverPopover({ trigger, children, contentClassName, side, align }: HoverPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // Only a real mouse hovers; touch "hover" events would fight the tap toggle.
  const hoverHandlers = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") schedule(true, OPEN_DELAY);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") schedule(false, CLOSE_DELAY);
    },
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild {...hoverHandlers}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className={contentClassName}
        // Hover-opened popovers shouldn't steal focus from wherever the user is.
        onOpenAutoFocus={(e) => e.preventDefault()}
        {...hoverHandlers}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent, HoverPopover };
