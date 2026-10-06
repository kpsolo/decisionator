import { Bot, Sparkles } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "./ui/badge.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";

export interface AgentAttributionBadgeProps {
  agentName?: string;
  onBehalfOf?: string;
  confidence?: number;
  timestamp?: string;
  model?: string;
  className?: string;
}

export const AgentAttributionBadge: React.FC<AgentAttributionBadgeProps> = ({
  agentName = "Agent",
  onBehalfOf,
  confidence,
  timestamp,
  model,
  className,
}) => {
  const formattedConfidence =
    confidence !== undefined ? `${Math.round(confidence * 100)}% confidence` : null;

  const tooltipText = [
    model ? `Model: ${model}` : null,
    timestamp ? `Generated: ${new Date(timestamp).toLocaleString()}` : null,
    onBehalfOf ? `On behalf of: ${onBehalfOf}` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const badgeContent = (
    <Badge variant="agent" className={cn("gap-1.5 px-2 py-0.5 text-[11px] select-none", className)}>
      <Bot className="h-3 w-3 shrink-0" />
      <span>{agentName}</span>
      {confidence !== undefined && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-agent/20 px-1.5 py-0 text-[10px] font-semibold text-agent">
          <Sparkles className="h-2.5 w-2.5" />
          {formattedConfidence}
        </span>
      )}
    </Badge>
  );

  if (!tooltipText) {
    return badgeContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Focusable so keyboard users can reach the attribution details too. */}
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: tooltip trigger must be focusable
          tabIndex={0}
          aria-label={`${agentName}. ${tooltipText}`}
          className="inline-flex cursor-help rounded-full ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {badgeContent}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
};
