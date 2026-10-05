import type { Comment, Grade, Option } from "../model/index.js";

export interface OptionStats {
  optionId: string;
  title: string;
  category?: string;
  tags: string[];
  average: number;
  count: number;
  distribution: [number, number, number, number, number]; // 1-star to 5-star count
  commentsCount: number;
  bordaPoints: number;
}

export type SortKey = "average" | "count" | "comments" | "bordaPoints" | "title";
export type GroupKey = "none" | "category" | "tag";

export function computeOptionStats(
  options: Option[],
  grades: Grade[],
  comments: Comment[]
): Map<string, OptionStats> {
  const statsMap = new Map<string, OptionStats>();

  // Initialize per option
  for (const opt of options) {
    statsMap.set(opt.id, {
      optionId: opt.id,
      title: opt.title,
      category: opt.category,
      tags: opt.tags || [],
      average: 0,
      count: 0,
      distribution: [0, 0, 0, 0, 0],
      commentsCount: 0,
      bordaPoints: 0,
    });
  }

  // Count comments
  for (const c of comments) {
    if (c.hidden) continue;
    const stat = statsMap.get(c.optionId);
    if (stat) {
      stat.commentsCount++;
    }
  }

  // Deduplicate grades: latest grade per (by, optionId)
  const latestGrades = new Map<string, Grade>();
  for (const g of grades) {
    const key = `${g.by}:${g.optionId}`;
    const existing = latestGrades.get(key);
    if (!existing || g.at >= existing.at) {
      latestGrades.set(key, g);
    }
  }

  // Compute distribution & sum
  const sumMap = new Map<string, number>();
  for (const g of latestGrades.values()) {
    const stat = statsMap.get(g.optionId);
    if (stat && g.value >= 1 && g.value <= 5) {
      stat.count++;
      const idx = (g.value - 1) as 0 | 1 | 2 | 3 | 4;
      stat.distribution[idx] = (stat.distribution[idx] ?? 0) + 1;
      sumMap.set(g.optionId, (sumMap.get(g.optionId) || 0) + g.value);
    }
  }

  // Compute average to 1 decimal place
  for (const [id, stat] of statsMap.entries()) {
    if (stat.count > 0) {
      const sum = sumMap.get(id) || 0;
      stat.average = Math.round((sum / stat.count) * 10) / 10;
    }
  }

  return statsMap;
}

export function sortAndGroupStats(
  stats: OptionStats[],
  sortBy: SortKey = "average",
  groupBy: GroupKey = "none"
): { groupName: string; items: OptionStats[] }[] {
  const sorted = [...stats].sort((a, b) => {
    if (sortBy === "average") return b.average - a.average || b.count - a.count;
    if (sortBy === "count") return b.count - a.count || b.average - a.average;
    if (sortBy === "comments") return b.commentsCount - a.commentsCount;
    if (sortBy === "bordaPoints") return b.bordaPoints - a.bordaPoints;
    if (sortBy === "title") return a.title.localeCompare(b.title);
    return 0;
  });

  if (groupBy === "none") {
    return [{ groupName: "All Options", items: sorted }];
  }

  if (groupBy === "category") {
    const groupMap = new Map<string, OptionStats[]>();
    for (const item of sorted) {
      const cat = item.category || "Uncategorized";
      if (!groupMap.has(cat)) groupMap.set(cat, []);
      groupMap.get(cat)?.push(item);
    }
    return Array.from(groupMap.entries()).map(([groupName, items]) => ({
      groupName,
      items,
    }));
  }

  if (groupBy === "tag") {
    const groupMap = new Map<string, OptionStats[]>();
    for (const item of sorted) {
      if (item.tags.length === 0) {
        if (!groupMap.has("Untagged")) groupMap.set("Untagged", []);
        groupMap.get("Untagged")?.push(item);
      } else {
        for (const tag of item.tags) {
          if (!groupMap.has(tag)) groupMap.set(tag, []);
          groupMap.get(tag)?.push(item);
        }
      }
    }
    return Array.from(groupMap.entries()).map(([groupName, items]) => ({
      groupName,
      items,
    }));
  }

  return [{ groupName: "All Options", items: sorted }];
}
