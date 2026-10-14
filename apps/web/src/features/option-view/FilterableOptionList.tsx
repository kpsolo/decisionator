import type { Option } from "@decisionator/core";
import { Search, X } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { useOptionList } from "./OptionExtensionsProvider.js";
import { OptionListBar } from "./OptionPlaces.js";

export type OptionSortMode =
  | "default"
  | "rating-desc"
  | "unrated-first"
  | "comments-desc"
  | "alpha-asc";

export interface FilterableOptionListProps {
  options: Option[];
  renderOption(option: Option, index: number): React.ReactNode;
  label?: string;
  statsMap?: Map<string, { average?: number; count?: number; commentsCount?: number }>;
  myGrades?: Map<string, number>;
}

/**
 * The option list with plugin summaries, search, and sorting filters above it (contract `option-view`, list
 * place). A filter applies to active options only; with no filter every option is listed.
 */
export function FilterableOptionList({
  options,
  renderOption,
  label = "Options",
  statsMap,
  myGrades,
}: FilterableOptionListProps) {
  const active = useMemo(() => options.filter((o) => o.status === "active"), [options]);
  const list = useOptionList(active);
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<OptionSortMode>("default");

  const activeFilter =
    filter && list.filters.some((f) => `${f.plugin}/${f.id}` === filter) ? filter : null;

  const shown = useMemo(() => {
    let result = options.map((o, index) => ({ o, index }));
    if (activeFilter) {
      result = result.filter(({ o }) => o.status === "active" && list.matches(activeFilter, o.id));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(({ o }) => {
        const titleMatch = o.title.toLowerCase().includes(q);
        const descMatch = o.description?.toLowerCase().includes(q) ?? false;
        const tagMatch = o.tags?.some((t) => t.toLowerCase().includes(q)) ?? false;
        const catMatch = o.category?.toLowerCase().includes(q) ?? false;
        return titleMatch || descMatch || tagMatch || catMatch;
      });
    }

    if (sortMode === "rating-desc") {
      result = [...result].sort((a, b) => {
        const avgA = statsMap?.get(a.o.id)?.average ?? 0;
        const avgB = statsMap?.get(b.o.id)?.average ?? 0;
        if (avgB !== avgA) return avgB - avgA;
        return a.index - b.index;
      });
    } else if (sortMode === "unrated-first") {
      result = [...result].sort((a, b) => {
        const hasA = (myGrades?.get(a.o.id) ?? 0) > 0;
        const hasB = (myGrades?.get(b.o.id) ?? 0) > 0;
        if (!hasA && hasB) return -1;
        if (hasA && !hasB) return 1;
        return a.index - b.index;
      });
    } else if (sortMode === "comments-desc") {
      result = [...result].sort((a, b) => {
        const countA = statsMap?.get(a.o.id)?.commentsCount ?? 0;
        const countB = statsMap?.get(b.o.id)?.commentsCount ?? 0;
        if (countB !== countA) return countB - countA;
        return a.index - b.index;
      });
    } else if (sortMode === "alpha-asc") {
      result = [...result].sort((a, b) => a.o.title.localeCompare(b.o.title));
    }

    return result;
  }, [options, activeFilter, list, search, sortMode, statsMap, myGrades]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <OptionListBar list={list} activeFilter={activeFilter} onFilterChange={setFilter} />
        {options.length > 2 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 shrink-0">
              <label
                htmlFor="option-sort-select"
                className="text-xs text-muted-foreground whitespace-nowrap sr-only sm:not-sr-only"
              >
                Sort:
              </label>
              <select
                id="option-sort-select"
                aria-label="Sort options"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as OptionSortMode)}
                className="h-9 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="default">Original order</option>
                <option value="rating-desc">Highest rated</option>
                {myGrades && <option value="unrated-first">My unrated first</option>}
                <option value="comments-desc">Most discussed</option>
                <option value="alpha-asc">Title (A–Z)</option>
              </select>
            </div>

            <div className="relative w-full sm:w-56">
              <Search
                className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <Input
                type="search"
                placeholder="Search options..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-8 h-9 text-xs"
                aria-label="Search options"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground focus-visible:outline-hidden"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <ul className="space-y-3" aria-label={label}>
        {shown.map(({ o, index }) => renderOption(o, index))}
      </ul>

      {shown.length === 0 && (
        <div className="rounded-lg border border-border/80 bg-muted/20 p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            {search.trim() ? `No options found matching "${search.trim()}".` : "Nothing left here."}
          </p>
          {search.trim() && (
            <Button variant="outline" size="sm" onClick={() => setSearch("")} className="text-xs">
              Clear search
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
