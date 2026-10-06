import type { QuotaBudget } from "@decisionator/store-google-sheets";
import { X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";

export interface DevToolbarProps {
  budget?: QuotaBudget;
  onForce429?: () => void;
  onToggleOffline?: (offline: boolean) => void;
}

export const DevToolbar: React.FC<DevToolbarProps> = ({ budget, onForce429, onToggleOffline }) => {
  const [isOffline, setIsOffline] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  // Dev toolbar only active in non-production environments
  if (import.meta.env.PROD) {
    return null;
  }

  const handleForce429 = () => {
    if (budget) {
      budget.handleRateLimit();
    }
    onForce429?.();
  };

  const handleToggleOffline = () => {
    const nextState = !isOffline;
    setIsOffline(nextState);
    onToggleOffline?.(nextState);
  };

  if (collapsed) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-3 right-3 z-[9999] h-8 px-2.5 rounded-full shadow-lg border border-border text-xs opacity-85 hover:opacity-100"
      >
        🛠️ Dev
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-3 right-3 z-[9999] shadow-2xl border-border bg-card/95 backdrop-blur-sm max-w-xs">
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-semibold text-foreground">
          🛠️ Dev Toolbar (T072)
        </CardTitle>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Close Dev Toolbar"
        >
          <X className="h-4 w-4" />
        </button>
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleForce429}
            className="h-7 text-[11px] px-2"
          >
            ⚡ Force 429 Rate Limit
          </Button>

          <Button
            type="button"
            variant={isOffline ? "default" : "outline"}
            size="sm"
            onClick={handleToggleOffline}
            className="h-7 text-[11px] px-2"
          >
            {isOffline ? "🌐 Go Online" : "🔌 Go Offline"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
