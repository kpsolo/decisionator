import type { Entry, ProjectSnapshot } from "@decisionator/plugin-sdk";
import { useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { toast } from "../../components/ui/use-toast.js";
import { useResetTools } from "../option-view/OptionExtensionsProvider.js";

type ResetEntry = Extract<Entry, { kind: "reset" }>;

const ALL = "__all__";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Who has votes in this project, labelled by their display name when known. */
export function voters(snapshot: ProjectSnapshot): { id: string; name: string }[] {
  const names = new Map<string, string>();
  const add = (by: string, byName?: string) => {
    if (!names.has(by) || (byName && names.get(by) === by)) names.set(by, byName ?? by);
  };
  for (const g of snapshot.grades) add(g.by, g.byName);
  for (const r of snapshot.rankings) add(r.by, r.byName);
  for (const g of snapshot.history?.grades ?? []) add(g.by, g.byName);
  for (const r of snapshot.history?.rankings ?? []) add(r.by, r.byName);
  return [...names]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The confirmation sentence: "Clear 12 grades and 1 ballot from Tom?" (FR-030). */
export function resetSummary(input: {
  snapshot: ProjectSnapshot;
  who: string | null;
  name: string;
  votes: boolean;
  properties: string[];
}): string {
  const { snapshot, who, votes } = input;
  const round = snapshot.project.voting?.round ?? 1;
  const mine = (by: string) => who === null || by === who;
  const grades = snapshot.grades.filter((g) => mine(g.by)).length;
  const ballots = snapshot.rankings.filter((r) => mine(r.by) && (r.round ?? 1) === round).length;
  const parts: string[] = [];
  if (votes)
    parts.push(`${plural(grades, "grade", "grades")} and ${plural(ballots, "ballot", "ballots")}`);
  if (input.properties.length > 0) parts.push(`${input.properties.join(", ")} on every option`);
  if (parts.length === 0) return "Nothing selected.";
  const from = votes ? (who === null ? " from everyone" : ` from ${input.name}`) : "";
  return `Clear ${parts.join(" and ")}${from}?`;
}

/**
 * Owner-only reset (User Story 6): clears all votes, or one participant's, and shared plugin
 * properties. Recorded as reset entries; nothing is deleted and past outcomes still verify.
 */
export function ResetDialog({
  open,
  onOpenChange,
  snapshot,
  appendEntries,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: ProjectSnapshot;
  appendEntries(entries: Entry[]): Promise<void>;
}) {
  const tools = useResetTools();
  const people = useMemo(() => voters(snapshot), [snapshot]);
  const [who, setWho] = useState<string>(ALL);
  const [votes, setVotes] = useState(true);
  const [props, setProps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const whoId = useId();
  const round = snapshot.project.voting?.round ?? 1;
  const target = who === ALL ? null : who;
  const name = people.find((p) => p.id === target)?.name ?? "";
  const sharedDefs = tools?.sharedDefs ?? [];
  const chosenLabels = sharedDefs
    .filter((d) => props.includes(`${d.plugin}/${d.key}`))
    .map((d) => d.label);
  const summary = resetSummary({ snapshot, who: target, name, votes, properties: chosenLabels });

  const confirm = async () => {
    const scope =
      target === null
        ? ({ scope: "all" } as const)
        : ({ scope: "participant", participantId: target } as const);
    const voteResets: ResetEntry[] = votes
      ? [
          { kind: "reset", ...scope, targets: ["grades"] },
          { kind: "reset", ...scope, targets: ["ballots"], round },
        ]
      : [];
    const propertyResets: ResetEntry[] = sharedDefs
      .filter((d) => props.includes(`${d.plugin}/${d.key}`))
      .map((d) => ({
        kind: "reset",
        scope: "all",
        targets: ["properties"],
        plugin: d.plugin,
        key: d.key,
      }));
    setSaving(true);
    try {
      if (voteResets.length > 0) await appendEntries(voteResets);
      if (propertyResets.length > 0) await tools?.appendResets(propertyResets);
      toast({
        title: "Reset recorded",
        description: summary.replace(/^Clear/, "Cleared").replace(/\?$/, "."),
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Not reset",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const nothing = !votes && props.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Reset</DialogTitle>
        <DialogDescription>
          Start over without losing history: cleared entries stay in the project's history and
          exports, and earlier outcomes still verify.
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={whoId} className="text-sm font-medium">
              Whose votes
            </label>
            <NativeSelect
              id={whoId}
              value={who}
              wrapperClassName="w-full"
              onChange={(e) => setWho(e.target.value)}
            >
              <option value={ALL}>All votes</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">What to clear</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={votes}
                onChange={(e) => setVotes(e.target.checked)}
              />
              {`Grades and round ${round} ballots`}
            </label>
            {sharedDefs.map((d) => {
              const key = `${d.plugin}/${d.key}`;
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={props.includes(key)}
                    onChange={(e) =>
                      setProps((p) => (e.target.checked ? [...p, key] : p.filter((x) => x !== key)))
                    }
                  />
                  {`${d.label} (${d.pluginName}), every option`}
                </label>
              );
            })}
          </fieldset>
          <p
            className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
            aria-live="polite"
          >
            {summary}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={nothing || saving}
            onClick={confirm}
          >
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
