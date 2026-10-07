import {
  type Contribution,
  type Option,
  type OptionPropertyDefinition,
  PROPERTY_VALUE_MAX_BYTES,
  type PropertyScalar,
  type PropertyValue,
  type SourceRef,
  checkPropertyValue,
  effectivePropertyValues,
  propertyValueBytes,
} from "@decisionator/core";

/** A property declaration together with the enabled plugin that declares it. */
export type DeclaredOptionProperty = OptionPropertyDefinition & { plugin: string };

export interface ProjectData {
  title: string;
  description?: string;
  options: Option[];
  contributions: Contribution[];
  sourceRefs: { id: string; title?: string; url?: string }[];
  /** Property declarations of the project's enabled plugins. Default `[]`. */
  optionProperties?: DeclaredOptionProperty[];
  /** Stored property values, shared and per person. Default `[]`. */
  properties?: PropertyValue[];
}

export interface SetSharedPropertyInput {
  optionId: string;
  plugin: string;
  key: string;
  value: unknown;
}

export type SetSharedPropertyResult =
  | { ok: true; value: PropertyValue }
  | { ok: false; status: 400 | 403 | 404 | 413; code: string; message: string };

export const PERSON_PROPERTY_REFUSAL = "Only the person it belongs to can set this property.";

export class AgentStateStore {
  private projects = new Map<string, ProjectData>();
  private contributionsByRequest = new Map<string, Contribution[]>();

  setProject(projectId: string, data: ProjectData): void {
    this.projects.set(projectId, {
      ...data,
      optionProperties: data.optionProperties ?? [],
      properties: data.properties ?? [],
    });
  }

  /** Declarations of the project's enabled plugins. */
  getOptionProperties(projectId: string): DeclaredOptionProperty[] {
    return this.projects.get(projectId)?.optionProperties ?? [];
  }

  /**
   * Effective shared values (latest wins per plugin, key and option), optionally limited to some
   * options. Per-person values are never returned: they belong to people, not to agents.
   */
  getSharedPropertyValues(projectId: string, optionIds?: readonly string[]): PropertyValue[] {
    const all = this.projects.get(projectId)?.properties ?? [];
    const shared = effectivePropertyValues(all.filter((v) => v.scope === "shared"));
    return optionIds ? shared.filter((v) => optionIds.includes(v.optionId)) : shared;
  }

  /**
   * Sets a shared property value for an agent. The option must exist and the property must be
   * declared by an enabled plugin with `scope: "shared"`; the value is checked against the
   * declaration. `null` clears the value.
   */
  setSharedProperty(
    projectId: string,
    input: SetSharedPropertyInput,
    agent: { id: string; name: string }
  ): SetSharedPropertyResult {
    const p = this.projects.get(projectId);
    if (!p || !p.options.some((o) => o.id === input.optionId)) {
      return { ok: false, status: 404, code: "NOT_FOUND", message: "Option not found" };
    }
    const def = (p.optionProperties ?? []).find(
      (d) => d.plugin === input.plugin && d.key === input.key
    );
    if (!def) {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "No enabled plugin declares this property",
      };
    }
    if (def.scope !== "shared") {
      return {
        ok: false,
        status: 403,
        code: "NOT_PERMITTED_FOR_AGENTS",
        message: PERSON_PROPERTY_REFUSAL,
      };
    }
    const check = checkPropertyValue(def, input.value);
    if (!check.ok) {
      return { ok: false, status: 400, code: "INVALID_PARAMS", message: check.message };
    }
    if (propertyValueBytes(input.value) > PROPERTY_VALUE_MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "TOO_LARGE",
        message: `Property value exceeds ${PROPERTY_VALUE_MAX_BYTES} bytes`,
      };
    }
    const stored: PropertyValue = {
      id: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      at: new Date().toISOString(),
      by: agent.id,
      byName: agent.name,
      optionId: input.optionId,
      plugin: input.plugin,
      key: input.key,
      scope: "shared",
      value: input.value as PropertyScalar,
    };
    p.properties = [...(p.properties ?? []), stored];
    return { ok: true, value: stored };
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
