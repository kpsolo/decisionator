import type { Option } from "@decisionator/core";
import type React from "react";
import { useMemo, useState } from "react";
import { useOptionList } from "./OptionExtensionsProvider.js";
import { OptionListBar } from "./OptionPlaces.js";

/**
 * The option list with plugin summaries and filters above it (contract `option-view`, list
 * place). A filter applies to active options only; with no filter every option is listed.
 */
export function FilterableOptionList({
  options,
  renderOption,
  label = "Options",
}: {
  options: Option[];
  renderOption(option: Option, index: number): React.ReactNode;
  label?: string;
}) {
  const active = useMemo(() => options.filter((o) => o.status === "active"), [options]);
  const list = useOptionList(active);
  const [filter, setFilter] = useState<string | null>(null);
  const activeFilter =
    filter && list.filters.some((f) => `${f.plugin}/${f.id}` === filter) ? filter : null;

  const shown = useMemo(
    () =>
      activeFilter
        ? options
            .map((o, index) => ({ o, index }))
            .filter(({ o }) => o.status === "active" && list.matches(activeFilter, o.id))
        : options.map((o, index) => ({ o, index })),
    [options, activeFilter, list]
  );

  return (
    <div className="space-y-3">
      <OptionListBar list={list} activeFilter={activeFilter} onFilterChange={setFilter} />
      <ul className="space-y-3" aria-label={label}>
        {shown.map(({ o, index }) => renderOption(o, index))}
      </ul>
      {activeFilter && shown.length === 0 && (
        <output className="block text-sm text-muted-foreground">Nothing left here.</output>
      )}
    </div>
  );
}
