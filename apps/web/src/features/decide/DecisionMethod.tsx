import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import { AlertTriangle, Gavel } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { getInstalledPlugins } from "../plugins/plugin-registry.js";
import {
  BUILTIN_STRATEGIES,
  OWNER_PICK_ID,
  WEIGHTED_ID,
  chosenStrategy,
  defaultSettings,
  enabledStrategies,
} from "./strategies.js";

/** "Decided by: …" — which method will decide this project (FR-037). */
export function DecidedBy({ snapshot }: { snapshot: Pick<ProjectSnapshot, "project"> }) {
  const chosen = chosenStrategy(snapshot);
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="decided-by">
      <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground">{`Decided by: ${chosen.name}`}</span>
        {chosen.descriptor && <span>{` — ${chosen.descriptor.description}`}</span>}
      </span>
    </p>
  );
}

/**
 * Owner's choice of the project's decision method and its settings (FR-035). Changing it while
 * people have voted asks for confirmation first.
 */
export function DecisionMethodPicker({
  snapshot,
  onSave,
}: {
  snapshot: ProjectSnapshot;
  onSave(strategy: {
    id: string;
    version: string;
    settings: Record<string, unknown>;
  }): Promise<void>;
}) {
  const available = useMemo(() => enabledStrategies(getInstalledPlugins()), []);
  const chosen = chosenStrategy(snapshot, available);
  const [id, setId] = useState(chosen.id);
  const [settings, setSettings] = useState<Record<string, unknown>>(chosen.settings);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectId = useId();
  const pickId = useId();

  const descriptor = BUILTIN_STRATEGIES.find((s) => s.id === id);
  const round = snapshot.project.voting?.round ?? 1;
  const ballots = snapshot.rankings.filter((r) => (r.round ?? 1) === round).length;
  const votingOpen = snapshot.project.voting?.state === "open";
  const changed = id !== chosen.id || JSON.stringify(settings) !== JSON.stringify(chosen.settings);
  const activeOptions = snapshot.options.filter((o) => o.status === "active");

  const save = async () => {
    if (!descriptor) return;
    if (votingOpen && ballots > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ id, version: descriptor.version, settings });
      setConfirming(false);
      setMessage(`Saved. This project is now decided by ${descriptor.name}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border bg-card shadow-xs">
      <CardHeader>
        <CardTitle className="text-base">Decision method</CardTitle>
        <CardDescription>
          How this project is decided when you close voting. Everyone can see the method.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!chosen.descriptor && (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {`${chosen.name} is not available. Choose another method before closing the vote.`}
          </p>
        )}
        <div className="space-y-1.5">
          <label htmlFor={selectId} className="text-sm font-medium">
            Method
          </label>
          <NativeSelect
            id={selectId}
            value={id}
            wrapperClassName="w-full"
            onChange={(e) => {
              setId(e.target.value);
              setSettings(defaultSettings(e.target.value, snapshot.project));
              setConfirming(false);
            }}
          >
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          {descriptor && <p className="text-xs text-muted-foreground">{descriptor.description}</p>}
        </div>

        {id === WEIGHTED_ID && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={settings.includeUngraded === true}
              onChange={(e) => setSettings({ ...settings, includeUngraded: e.target.checked })}
            />
            Include ungraded options
          </label>
        )}
        {id === OWNER_PICK_ID && (
          <div className="space-y-1.5">
            <label htmlFor={pickId} className="text-sm font-medium">
              Winning option
            </label>
            <NativeSelect
              id={pickId}
              value={typeof settings.pick === "string" ? settings.pick : ""}
              wrapperClassName="w-full"
              onChange={(e) =>
                setSettings({ ...settings, ...(e.target.value ? { pick: e.target.value } : {}) })
              }
            >
              <option value="">Choose when closing</option>
              {activeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        {confirming && (
          <p
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            {`${ballots} ${ballots === 1 ? "person has" : "people have"} already voted. Changing the method now may change the result.`}
          </p>
        )}
        {message && (
          <output aria-live="polite" className="block text-sm text-muted-foreground">
            {message}
          </output>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t border-border pt-4">
        {confirming && (
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
        <Button type="button" onClick={save} disabled={!changed || saving || !descriptor}>
          {confirming ? "Change anyway" : "Save method"}
        </Button>
      </CardFooter>
    </Card>
  );
}
