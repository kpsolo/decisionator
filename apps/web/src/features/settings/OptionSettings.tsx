import { OPTION_STATUS_PLUGIN_ID } from "@decisionator/option-status";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import {
  MARKER_CHOICE_KEY,
  replacesMarker,
  settingsWithDefaults,
} from "../option-view/extensions.js";
import {
  type InstalledPlugin,
  getInstalledPlugins,
  subscribePlugins,
  updatePlugin,
} from "../plugins/plugin-registry.js";

export const SECONDS_ERROR = "The time must be between 1 and 300 seconds.";

/** Parses the seconds field: a whole number from 1 to 300, or null. */
export function parseSeconds(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= 300 ? n : null;
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(MARKER_CHOICE_KEY);
  } catch {
    return null;
  }
}

/**
 * Settings → Options (User Stories 2 and 4): automatic "Seen" marking and, when several plugins
 * replace the unseen marker, which one is used. Personal to this device.
 */
export function OptionSettings() {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(getInstalledPlugins);
  useEffect(() => subscribePlugins(setPlugins), []);
  const status = plugins.find((p) => p.id === OPTION_STATUS_PLUGIN_ID && p.enabled);
  const markers = plugins.filter((p) => p.enabled && replacesMarker(p));
  if (!status && markers.length < 2) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Options</CardTitle>
        <CardDescription>
          How options you have looked at are marked. These settings apply to every project on this
          device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {status && <StatusSettings plugin={status} />}
        {markers.length >= 2 && <MarkerChoice plugins={markers} />}
      </CardContent>
    </Card>
  );
}

function StatusSettings({ plugin }: { plugin: InstalledPlugin }) {
  const current = settingsWithDefaults(plugin);
  const autoMark = current.autoMark !== false;
  const savedSeconds = typeof current.seconds === "number" ? current.seconds : 5;
  const [draft, setDraft] = useState(String(savedSeconds));
  const [error, setError] = useState<string | null>(null);
  const autoId = useId();
  const secondsId = useId();
  const errorId = useId();
  useEffect(() => setDraft(String(savedSeconds)), [savedSeconds]);

  const save = (patch: Record<string, unknown>) =>
    updatePlugin(plugin.id, { settings: { ...plugin.settings, ...patch } });

  const commitSeconds = () => {
    const n = parseSeconds(draft);
    if (n === null) {
      setError(SECONDS_ERROR);
      setDraft(String(savedSeconds));
      return;
    }
    setError(null);
    if (n !== savedSeconds) save({ seconds: n });
  };

  return (
    <div className="space-y-3">
      <label htmlFor={autoId} className="flex items-center gap-2 text-sm font-medium">
        <input
          id={autoId}
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={autoMark}
          onChange={(e) => save({ autoMark: e.target.checked })}
        />
        Mark options as seen automatically
      </label>
      <div className="space-y-1.5">
        <label htmlFor={secondsId} className="text-sm font-medium">
          Seconds an option must stay on screen
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={secondsId}
            inputMode="numeric"
            className="h-9 w-24"
            value={draft}
            disabled={!autoMark}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitSeconds}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSeconds();
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!autoMark}
            onClick={commitSeconds}
          >
            Save
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function MarkerChoice({ plugins }: { plugins: InstalledPlugin[] }) {
  const [choice, setChoice] = useState(() => readChoice() ?? plugins[0]?.id ?? "");
  const id = useId();
  const value = plugins.some((p) => p.id === choice) ? choice : (plugins[0]?.id ?? "");
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Marker style
      </label>
      <NativeSelect
        id={id}
        value={value}
        wrapperClassName="w-full max-w-xs"
        onChange={(e) => {
          setChoice(e.target.value);
          try {
            localStorage.setItem(MARKER_CHOICE_KEY, e.target.value);
          } catch {
            // private mode: the choice lasts for this page only
          }
          window.dispatchEvent(new Event("deci:marker-choice"));
        }}
      >
        {plugins.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      <p className="text-xs text-muted-foreground">
        Several plugins can mark options you have not seen. Choose whose marker you see.
      </p>
    </div>
  );
}
