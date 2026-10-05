import type { Contribution, Option, SourceRef } from "@decisionator/core";

export interface ProjectData {
  title: string;
  description?: string;
  options: Option[];
  contributions: Contribution[];
  sourceRefs: { id: string; title?: string; url?: string }[];
}

export class AgentStateStore {
  private projects = new Map<string, ProjectData>();
  private contributionsByRequest = new Map<string, Contribution[]>();

  setProject(projectId: string, data: ProjectData): void {
    this.projects.set(projectId, data);
  }

  getProject(projectId: string): ProjectData | undefined {
    return this.projects.get(projectId);
  }

  getOptions(projectId: string): Option[] {
    return this.projects.get(projectId)?.options || [];
  }

  getAcceptedContributions(projectId: string): Contribution[] {
    const p = this.projects.get(projectId);
    if (!p) return [];
    return p.contributions.filter((c) => c.reviewStatus === "accepted");
  }

  getOwnContributions(requestId: string): Contribution[] {
    return this.contributionsByRequest.get(requestId) || [];
  }

  addContribution(requestId: string, contribution: Contribution): Contribution {
    // Add to request's own list
    const own = this.contributionsByRequest.get(requestId) || [];
    own.push(contribution);
    this.contributionsByRequest.set(requestId, own);

    // Also add to project data
    const p = this.projects.get(contribution.targetId) || Array.from(this.projects.values())[0];
    if (p) {
      p.contributions.push(contribution);
    }

    return contribution;
  }

  updateContribution(id: string, updates: Partial<Contribution>): Contribution | null {
    // Look up across requests
    for (const [, list] of this.contributionsByRequest.entries()) {
      const found = list.find((c) => c.id === id);
      if (found) {
        if (updates.body !== undefined) found.body = updates.body;
        if (updates.pros !== undefined) found.pros = updates.pros;
        if (updates.cons !== undefined) found.cons = updates.cons;
        if (updates.sources !== undefined) found.sources = updates.sources;
        return found;
      }
    }
    return null;
  }

  proposeOption(
    projectId: string,
    data: { title: string; description?: string; sources?: SourceRef[] }
  ): Option {
    const p = this.projects.get(projectId);
    const newOption: Option = {
      id: `opt_prop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: data.title,
      description: data.description || "",
      status: "proposed",
      order: (p?.options.length ?? 0) + 1,
      at: new Date().toISOString(),
      by: "agent",
      tags: [],
      pros: [],
      cons: [],
      links: (data.sources || []).map((s) => ({ title: s.title, url: s.url })),
    };
    if (p) {
      p.options.push(newOption);
    }
    return newOption;
  }
}
