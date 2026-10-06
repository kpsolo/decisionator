import { Radio } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Textarea } from "../../components/ui/textarea.js";
import { toast } from "../../components/ui/use-toast.js";
import { defaultNetworkConfig, loadNetworkConfig, saveNetworkConfig } from "./live-config.js";

/** Relays and ICE servers for live sessions, for networks where the defaults don't get through. */
export function LiveNetworkSettings() {
  const initial = loadNetworkConfig();
  const [relays, setRelays] = useState(initial.relays.join("\n"));
  const [ice, setIce] = useState(JSON.stringify(initial.iceServers, null, 2));
  const [iceError, setIceError] = useState<string | null>(null);
  const relaysId = useId();
  const iceId = useId();
  const iceErrorId = useId();

  const save = () => {
    let iceServers: RTCIceServer[];
    try {
      iceServers = JSON.parse(ice);
      if (!Array.isArray(iceServers)) throw new Error("Expected a JSON array of ICE servers.");
    } catch (err) {
      setIceError(err instanceof Error ? err.message : "Invalid JSON.");
      return;
    }
    setIceError(null);
    saveNetworkConfig({
      relays: relays
        .split(/\s+/)
        .map((r) => r.trim())
        .filter((r) => /^wss?:\/\//.test(r)),
      iceServers,
      sameBrowser: true,
    });
    toast({ title: "Live session network saved", description: "Applies to new sessions." });
  };

  const reset = () => {
    saveNetworkConfig(null);
    const d = defaultNetworkConfig();
    setRelays(d.relays.join("\n"));
    setIce(JSON.stringify(d.iceServers, null, 2));
    setIceError(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-primary" aria-hidden />
          Live session network
        </CardTitle>
        <CardDescription>
          Live sessions find each other through Nostr relays (they only pass encrypted connection
          offers) and connect directly with WebRTC. On networks that block direct connections, add a
          TURN server. With no relays, sessions only reach other tabs of this browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={relaysId} className="text-sm font-medium">
            Relays (one per line)
          </label>
          <Textarea
            id={relaysId}
            value={relays}
            onChange={(e) => setRelays(e.target.value)}
            rows={4}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={iceId} className="text-sm font-medium">
            ICE servers (JSON)
          </label>
          <Textarea
            id={iceId}
            value={ice}
            onChange={(e) => setIce(e.target.value)}
            rows={5}
            className="font-mono text-xs"
            aria-invalid={iceError ? true : undefined}
            aria-describedby={iceError ? iceErrorId : undefined}
          />
          {iceError && (
            <p id={iceErrorId} className="text-xs text-destructive">
              {iceError}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={reset}>
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
