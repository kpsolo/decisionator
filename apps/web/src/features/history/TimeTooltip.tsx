import type React from "react";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js";

/** How long a touch must be held to open the tooltip. */
export const LONG_PRESS_MS = 500;

export interface TimeTooltipProps {
  /** Tooltip text; lines are separated by "\n". Nothing is added when it is empty. */
  text: string | undefined;
  /**
   * The existing trigger. A function child receives the id of the visually hidden description,
   * for when `aria-describedby` belongs on an inner element (e.g. the stars' fieldset).
   */
  children: React.ReactElement | ((describedBy: string) => React.ReactElement);
  /** Adds `tabIndex={0}` to a trigger that is not focusable on its own (e.g. a text span). */
  focusable?: boolean;
  side?: "top" | "bottom" | "left" | "right";
}

/**
 * A time tooltip (FR-028, research R15) on an existing control: it opens on hover and keyboard
 * focus (Radix), and on a 500 ms touch long-press. The same text is always in the DOM, visually
 * hidden and linked with `aria-describedby`, so screen readers get it without hovering.
 */
export function TimeTooltip({ text, children, focusable = false, side = "top" }: TimeTooltipProps) {
  const id = useId();
  const descriptionId = `${id}-time`;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const element = typeof children === "function" ? children(descriptionId) : children;
  if (!text || !isValidElement(element)) return element;

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const props = element.props as Record<string, unknown>;
  const describedBy = [props["aria-describedby"], descriptionId].filter(Boolean).join(" ");
  const trigger = cloneElement(element as React.ReactElement<Record<string, unknown>>, {
    "aria-describedby": typeof children === "function" ? props["aria-describedby"] : describedBy,
    ...(focusable ? { tabIndex: 0 } : {}),
    onPointerDown: (e: React.PointerEvent) => {
      (props.onPointerDown as ((e: React.PointerEvent) => void) | undefined)?.(e);
      if (e.pointerType !== "touch") return;
      longPressed.current = false;
      cancel();
      timer.current = setTimeout(() => {
        longPressed.current = true;
        setOpen(true);
      }, LONG_PRESS_MS);
    },
    onPointerUp: (e: React.PointerEvent) => {
      (props.onPointerUp as ((e: React.PointerEvent) => void) | undefined)?.(e);
      cancel();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      (props.onPointerCancel as ((e: React.PointerEvent) => void) | undefined)?.(e);
      cancel();
    },
    onClickCapture: (e: React.MouseEvent) => {
      // A long-press shows the tooltip; it must not also press the control.
      if (longPressed.current) {
        longPressed.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      (props.onClickCapture as ((e: React.MouseEvent) => void) | undefined)?.(e);
    },
    onContextMenu: (e: React.MouseEvent) => {
      // Mobile browsers open a context menu on long-press; the tooltip replaces it.
      if (timer.current || longPressed.current) e.preventDefault();
      (props.onContextMenu as ((e: React.MouseEvent) => void) | undefined)?.(e);
    },
  });
  const lines = text.split("\n");

  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side={side} aria-hidden="true">
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static lines of one text
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {lines.join(". ")}
      </span>
    </>
  );
}
