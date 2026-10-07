import type { Option, PropertyScalar } from "@decisionator/core";
import type { IconName, Tone } from "@decisionator/plugin-sdk";
import DOMPurify from "dompurify";
import {
  AlertTriangle,
  Check,
  Clock,
  Coins,
  Eye,
  Flag,
  Heart,
  Info,
  Loader2,
  type LucideIcon,
  Star,
  Tag,
} from "lucide-react";
import MarkdownIt from "markdown-it";
import type React from "react";
import { useEffect, useId, useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { cn } from "../../lib/utils.js";
import {
  type PropertyRow,
  type ResolvedOptionList,
  type ResolvedOptionView,
  displayValue,
  useExposureRef,
  useOptionAction,
  usePropertyRows,
} from "./OptionExtensionsProvider.js";

/**
 * Host-rendered places of the option view (contract `option-view` 1.0.0). Plugins only supply
 * data; everything here uses the app's own components and theme tokens.
 */

const ICONS: Record<IconName, LucideIcon> = {
  star: Star,
  flag: Flag,
  tag: Tag,
  coins: Coins,
  check: Check,
  eye: Eye,
  info: Info,
  alert: AlertTriangle,
  clock: Clock,
  heart: Heart,
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "border-border text-foreground",
  info: "border-sky-600/40 text-sky-800 dark:text-sky-300",
  success: "border-emerald-600/40 text-emerald-800 dark:text-emerald-300",
  warning: "border-amber-600/40 text-amber-900 dark:text-amber-300",
  danger: "border-rose-600/40 text-rose-800 dark:text-rose-300",
  primary: "border-primary/40 text-[#0066CC] dark:text-[#0B84FE]",
};

const TONE_FILL: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-sky-600 dark:bg-sky-400",
  success: "bg-emerald-600 dark:bg-emerald-400",
  warning: "bg-amber-500",
  danger: "bg-rose-600 dark:bg-rose-400",
  primary: "bg-[#0B84FE]",
};

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/** Extra title emphasis a marker asks for (the "unread mail" look). */
export function markerTitleClass(view: ResolvedOptionView): string | undefined {
  const v = view.marker?.variant;
  return v === "dot" || v === "bold" ? "font-extrabold" : undefined;
}

/**
 * The marker inline next to the title: a shape plus a visually hidden label, never colour alone.
 * `bar` and `ring` draw on the card edge instead (`OptionMarkerFrame`).
 */
export function OptionMarker({ view }: { view: ResolvedOptionView }) {
  const marker = view.marker;
  if (!marker) return null;
  const tone = marker.tone ?? "primary";
  return (
    <span className="inline-flex shrink-0 items-center" data-option-marker={marker.variant}>
      {marker.variant === "dot" && (
        <span className={cn("h-2.5 w-2.5 rounded-full", TONE_FILL[tone])} aria-hidden="true" />
      )}
      <span className="sr-only">{marker.label}</span>
    </span>
  );
}

/** Edge decoration for `bar` and `ring` markers; the card must be `position: relative`. */
export function OptionMarkerFrame({ view }: { view: ResolvedOptionView }) {
  const marker = view.marker;
  if (!marker || (marker.variant !== "bar" && marker.variant !== "ring")) return null;
  const tone = marker.tone ?? "primary";
  if (marker.variant === "bar") {
    return (
      <span
        className={cn(
          "pointer-events-none absolute inset-y-3 left-0 w-1.5 rounded-r-full",
          TONE_FILL[tone]
        )}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-inset",
        tone === "primary" ? "ring-[#0B84FE]" : "ring-current",
        TONE_TEXT[tone]
      )}
      aria-hidden="true"
    />
  );
}

export function OptionBadges({
  view,
  className,
}: { view: ResolvedOptionView; className?: string }) {
  if (view.badges.length === 0 && view.failed.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {view.badges.map((b) => {
        const Icon = b.icon ? ICONS[b.icon] : null;
        return (
          <Badge
            key={`${b.plugin}:${b.text}`}
            variant="outline"
            className={cn("font-medium", TONE_TEXT[b.tone ?? "neutral"])}
            title={b.title}
          >
            {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
            {b.text}
          </Badge>
        );
      })}
      <PluginNotice view={view} />
    </div>
  );
}

export function PluginNotice({ view }: { view: ResolvedOptionView }) {
  if (view.failed.length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground" role="note">
      A plugin could not display here.
    </span>
  );
}

export function OptionFooter({
  view,
  option,
  className,
}: {
  view: ResolvedOptionView;
  option: Option;
  className?: string;
}) {
  const run = useOptionAction();
  const [busy, setBusy] = useState<string | null>(null);
  if (view.footer.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {view.footer.map((item) => {
        if ("text" in item) {
          return (
            <span key={`${item.plugin}:t:${item.text}`} className="text-xs text-muted-foreground">
              {item.text}
            </span>
          );
        }
        const key = `${item.plugin}:${item.action.id}`;
        return (
          <Button
            key={key}
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs pointer-coarse:h-9"
            disabled={busy === key}
            aria-busy={busy === key}
            onClick={async () => {
              setBusy(key);
              try {
                await run(item.plugin, option, item.action.id);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === key && (
              <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
            )}
            {item.action.label}
          </Button>
        );
      })}
    </div>
  );
}

export function OptionSections({ view }: { view: ResolvedOptionView }) {
  if (view.sections.length === 0) return null;
  return (
    <>
      {view.sections.map((s) => (
        <section key={`${s.plugin}:${s.title}`} className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {s.title}
          </h5>
          <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4 text-sm">
            {s.blocks.map((b, i) => {
              const key = `${s.title}:${i}`;
              if ("text" in b) {
                return (
                  <p key={key} className="whitespace-pre-line">
                    {b.text}
                  </p>
                );
              }
              if ("markdown" in b) {
                return (
                  <div
                    key={key}
                    className="prose prose-sm max-w-none dark:prose-invert"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized like comments
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(md.render(b.markdown)),
                    }}
                  />
                );
              }
              return (
                <dl key={key} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {b.fields.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="[overflow-wrap:anywhere]">{value}</dd>
                    </div>
                  ))}
                </dl>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/** Declared, non-hidden properties of enabled plugins, editable where FR-012 allows. */
export function PropertySection({ option }: { option: Option }) {
  const { rows, setValue } = usePropertyRows(option);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Properties">
      <h5 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Properties
      </h5>
      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
        {rows.map((row) => (
          <PropertyField key={`${row.plugin.id}:${row.def.key}`} row={row} setValue={setValue} />
        ))}
      </dl>
    </section>
  );
}

function isInvalid(row: PropertyRow): boolean {
  const v = row.value;
  if (v === undefined || v === null) return false;
  switch (row.def.type) {
    case "number":
      return typeof v !== "number";
    case "boolean":
      return typeof v !== "boolean";
    case "choice":
      return !row.def.choices?.some((c) => c.value === v);
    default:
      return typeof v !== "string";
  }
}

function PropertyField({
  row,
  setValue,
}: {
  row: PropertyRow;
  setValue(row: PropertyRow, value: PropertyScalar): Promise<void>;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const [error, setError] = useState<string | null>(null);
  const invalid = isInvalid(row);

  if (!row.editable) {
    if (invalid) return null; // ignored for people who cannot fix it
    return (
      <div className="space-y-0.5">
        <dt className="text-xs text-muted-foreground">{row.label}</dt>
        <dd className="text-sm font-medium">
          {row.value === undefined || row.value === null ? "—" : displayValue(row.def, row.value)}
        </dd>
      </div>
    );
  }

  const save = async (value: PropertyScalar) => {
    try {
      await setValue(row, value);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-1">
      <dt>
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {row.label}
        </label>
      </dt>
      <dd className="space-y-1">
        <PropertyEditor
          id={id}
          row={row}
          invalid={invalid}
          describedBy={error ? errorId : undefined}
          onSave={save}
        />
        {invalid && !error && <p className="text-xs text-warning">Invalid value</p>}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </dd>
    </div>
  );
}

function PropertyEditor({
  id,
  row,
  invalid,
  describedBy,
  onSave,
}: {
  id: string;
  row: PropertyRow;
  invalid: boolean;
  describedBy?: string;
  onSave(value: PropertyScalar): void;
}) {
  const current = invalid ? undefined : row.value;
  const [draft, setDraft] = useState(
    current === undefined || current === null ? "" : String(current)
  );
  useEffect(() => {
    setDraft(current === undefined || current === null ? "" : String(current));
  }, [current]);

  if (row.def.type === "boolean") {
    return (
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-[#0B84FE]"
        checked={current === true}
        aria-describedby={describedBy}
        onChange={(e) => onSave(e.target.checked)}
      />
    );
  }
  if (row.def.type === "choice") {
    return (
      <select
        id={id}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={typeof current === "string" ? current : ""}
        aria-describedby={describedBy}
        onChange={(e) => onSave(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">—</option>
        {row.def.choices?.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (current === undefined || current === null ? "" : String(current))) return;
    if (trimmed === "") return onSave(null);
    if (row.def.type === "number") {
      const n = Number(trimmed);
      return onSave(Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(trimmed) ? n : trimmed);
    }
    onSave(trimmed);
  };
  return (
    <Input
      id={id}
      type={row.def.type === "date" ? "date" : "text"}
      inputMode={row.def.type === "number" ? "decimal" : undefined}
      value={draft}
      aria-describedby={describedBy}
      aria-invalid={describedBy ? true : undefined}
      className="h-9"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** Plugin summaries and filter toggles above the option list. */
export function OptionListBar({
  list,
  activeFilter,
  onFilterChange,
}: {
  list: ResolvedOptionList;
  activeFilter: string | null;
  onFilterChange(filter: string | null): void;
}) {
  if (list.summaries.length === 0 && list.filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="option-list-bar">
      {list.summaries.map((s) => (
        <span
          key={s.plugin}
          className="text-sm font-medium text-muted-foreground"
          aria-live="polite"
        >
          {s.text}
        </span>
      ))}
      {list.filters.map((f) => {
        const key = `${f.plugin}/${f.id}`;
        const on = activeFilter === key;
        return (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            className="h-7 px-2.5 text-xs pointer-coarse:h-9"
            onClick={() => onFilterChange(on ? null : key)}
          >
            {f.label}
          </Button>
        );
      })}
    </div>
  );
}

/** A wrapper whose content counts as showing `optionId` (ballot and results rows). */
export function ExposureBox({
  optionId,
  className,
  children,
}: {
  optionId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useExposureRef(optionId);
  return (
    <div ref={ref} className={className} data-option-id={optionId}>
      {children}
    </div>
  );
}
