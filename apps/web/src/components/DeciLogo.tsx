import type React from "react";
import { cn } from "../lib/utils.js";

export interface DeciLogoProps extends React.SVGProps<SVGSVGElement> {
  /**
   * - 'badge': Rounded squircle with gradient background, crisp white monogram, and cyan decision apex.
   * - 'glyph': Standalone abstract vector mark with brand gradient fill.
   * - 'monochrome': Standalone vector mark using currentColor.
   */
  variant?: "badge" | "glyph" | "monochrome";
  /** Width and height in pixels (defaults to 32 for badge, 24 for glyph). */
  size?: number | string;
  className?: string;
}

/**
 * Abstract brand icon for Deci (Decisionator).
 *
 * Symbolism:
 * - A bold geometric "D" monogram.
 * - An integrated convergence chevron (>) representing choices merging into action.
 * - A radiant cyan apex node representing the decisive consensus choice.
 */
export function DeciIcon({ variant = "badge", size, className, ...props }: DeciLogoProps) {
  const defaultSize = variant === "badge" ? 32 : 24;
  const dimension = size ?? defaultSize;

  if (variant === "badge") {
    return (
      <svg
        viewBox="0 0 64 64"
        width={dimension}
        height={dimension}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("shrink-0 select-none", className)}
        aria-hidden={props["aria-label"] ? undefined : true}
        role={props["aria-label"] ? "img" : undefined}
        {...props}
      >
        <defs>
          <linearGradient
            id="deci-badge-bg"
            x1="0"
            y1="0"
            x2="64"
            y2="64"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#0B84FE" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
          <linearGradient
            id="deci-badge-sheen"
            x1="0"
            y1="0"
            x2="0"
            y2="64"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* Squircle base */}
        <rect width="64" height="64" rx="16" fill="url(#deci-badge-bg)" />
        <rect width="64" height="64" rx="16" fill="url(#deci-badge-sheen)" />
        <rect
          width="64"
          height="64"
          rx="16"
          fill="none"
          stroke="rgba(0,0,0,0.1)"
          strokeWidth="1"
          className="dark:stroke-white/15"
        />

        {/* D Monogram with Integrated Chevron Counter */}
        <path
          d="M15 11 C15 9.34 16.34 8 18 8 H32 C45.25 8 56 18.75 56 32 C56 45.25 45.25 56 32 56 H18 C16.34 56 15 54.66 15 53 V11 Z M22.5 17.5 H30 L43 32 L30 46.5 H22.5 L34.5 32 L22.5 17.5 Z"
          fill="#ffffff"
          fillRule="evenodd"
        />

        {/* Decision Apex Node */}
        <polygon points="43.5,32 48.5,28 53.5,32 48.5,36" fill="#38bdf8" />
      </svg>
    );
  }

  if (variant === "monochrome") {
    return (
      <svg
        viewBox="0 0 64 64"
        width={dimension}
        height={dimension}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("shrink-0 select-none", className)}
        aria-hidden={props["aria-label"] ? undefined : true}
        role={props["aria-label"] ? "img" : undefined}
        {...props}
      >
        <path
          d="M14 10 C14 8.34 15.34 7 17 7 H32 C45.8 7 57 18.2 57 32 C57 45.8 45.8 57 32 57 H17 C15.34 57 14 55.66 14 54 V10 Z M22 17 H29.5 L42.5 32 L29.5 47 H22 L34 32 L22 17 Z"
          fill="currentColor"
          fillRule="evenodd"
        />
        <polygon points="43.5,32 48.5,28 53.5,32 48.5,36" fill="currentColor" opacity="0.8" />
      </svg>
    );
  }

  // Pure Gradient Glyph
  return (
    <svg
      viewBox="0 0 64 64"
      width={dimension}
      height={dimension}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none", className)}
      aria-hidden={props["aria-label"] ? undefined : true}
      role={props["aria-label"] ? "img" : undefined}
      {...props}
    >
      <defs>
        <linearGradient
          id="deci-glyph-grad"
          x1="12"
          y1="8"
          x2="56"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="45%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      <path
        d="M14 10 C14 8.34 15.34 7 17 7 H32 C45.8 7 57 18.2 57 32 C57 45.8 45.8 57 32 57 H17 C15.34 57 14 55.66 14 54 V10 Z M22 17 H29.5 L42.5 32 L29.5 47 H22 L34 32 L22 17 Z"
        fill="url(#deci-glyph-grad)"
        fillRule="evenodd"
      />
      <polygon points="43.5,32 48.5,28 53.5,32 48.5,36" fill="#ffffff" />
    </svg>
  );
}

export interface DeciLogoFullProps {
  size?: number | string;
  variant?: "badge" | "glyph" | "monochrome";
  className?: string;
  textClassName?: string;
}

/**
 * Full Deci logo including the abstract icon and wordmark.
 */
export function DeciLogo({
  size = 32,
  variant = "badge",
  className,
  textClassName,
}: DeciLogoFullProps) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <DeciIcon size={size} variant={variant} />
      <span className={cn("text-base font-semibold tracking-tight text-foreground", textClassName)}>
        Deci
      </span>
    </div>
  );
}

export default DeciIcon;
