import type { GroupKey, OptionStats, SortKey } from "@decisionator/core";
import { sortAndGroupStats } from "@decisionator/core";
import { BarChart3, MessageSquare, Star, Table2 } from "lucide-react";
import type React from "react";
import { useId, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Progress } from "../../components/ui/progress.js";

export interface StatsViewProps {
  stats: OptionStats[];
  showBordaSort?: boolean;
}

export const StatsView: React.FC<StatsViewProps> = ({ stats, showBordaSort = false }) => {
  const [sortBy, setSortBy] = useState<SortKey>("average");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual");
  const sortId = useId();
  const groupId = useId();

  const groups = useMemo(() => {
    return sortAndGroupStats(stats, sortBy, groupBy);
  }, [stats, sortBy, groupBy]);

  return (
    <Card className="stats-view">
      <CardHeader className="flex flex-col gap-4 space-y-0 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Project Statistics & Distributions</CardTitle>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor={sortId} className="text-xs font-medium text-muted-foreground">
              Sort by:
            </label>
            <NativeSelect
              id={sortId}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="average">Highest Average</option>
              <option value="count">Most Ratings</option>
              <option value="comments">Most Comments</option>
              {showBordaSort && <option value="bordaPoints">Borda Points</option>}
              <option value="title">Title (A-Z)</option>
            </NativeSelect>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={groupId} className="text-xs font-medium text-muted-foreground">
              Group by:
            </label>
            <NativeSelect
              id={groupId}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupKey)}
            >
              <option value="none">None</option>
              <option value="category">Category</option>
              <option value="tag">Tag</option>
            </NativeSelect>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setViewMode(viewMode === "visual" ? "table" : "visual")}
            leftIcon={
              viewMode === "visual" ? (
                <Table2 className="h-3.5 w-3.5" />
              ) : (
                <BarChart3 className="h-3.5 w-3.5" />
              )
            }
          >
            {viewMode === "visual" ? "Table View" : "Visual View"}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {stats.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No ratings yet. Statistics appear once participants start grading options.
          </p>
        ) : viewMode === "table" ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Option
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Average
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Ratings
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Comments
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups
                  .flatMap((g) => g.items)
                  .map((item) => (
                    <tr key={item.optionId} className="transition-colors hover:bg-muted/40">
                      <td className="px-3 py-2.5 font-medium [overflow-wrap:anywhere]">
                        {item.title}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{item.category || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-warning">
                        ★ {item.average.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.count}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.commentsCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.groupName} className="flex flex-col gap-3">
                {groupBy !== "none" && (
                  <h4 className="border-b border-border pb-1.5 text-sm font-semibold">
                    {group.groupName}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({group.items.length})
                    </span>
                  </h4>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  {group.items.map((item) => (
                    <div
                      key={item.optionId}
                      className="rounded-lg border border-border bg-background/60 p-4"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <strong className="text-sm font-semibold [overflow-wrap:anywhere]">
                          {item.title}
                        </strong>
                        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums text-warning">
                          <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
                          {item.average.toFixed(1)}
                        </span>
                      </div>
                      <p className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{item.count} votes</span>
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" aria-hidden />
                          {item.commentsCount} comments
                        </span>
                      </p>

                      {/* Distribution Bars */}
                      <div className="flex flex-col gap-1.5">
                        {[5, 4, 3, 2, 1].map((star) => {
                          const cnt = item.distribution[star - 1] || 0;
                          const pct = item.count > 0 ? (cnt / item.count) * 100 : 0;
                          return (
                            <div key={star} className="flex items-center gap-2 text-[11px]">
                              <span className="w-10 shrink-0 text-muted-foreground">
                                {star} star
                              </span>
                              <Progress
                                value={pct}
                                className="h-1.5"
                                indicatorClassName="bg-warning-solid"
                                aria-label={`${star} star: ${cnt} of ${item.count}`}
                              />
                              <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                                {cnt}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
