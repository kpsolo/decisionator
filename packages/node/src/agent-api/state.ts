import { createHash } from "node:crypto";
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
import type { LiveParticipantProfile, ProposeModerationInput } from "./schemas.js";

/** A property declaration together with the enabled plugin that declares it. */
export type DeclaredOptionProperty = OptionPropertyDefinition & { plugin: string };

export interface LiveSessionData {
  hosting: boolean;
  readOnly: boolean;
  revoked: boolean;
  participants: LiveParticipantProfile[];
}

export interface ModerationProposal {
  id: string;
  grantId: string;
  agentName: string;
  action: "drop_votes" | "set_read_only" | "allow_contributions" | "revoke_link";
  participantId?: string;
  reason: string;
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
  decidedAt?: string;
}

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
  private liveSessions = new Map<string, LiveSessionData>();
  private proposals = new Map<string, ModerationProposal[]>();
  private pseudonymMaps = new Map<string, Map<string, string>>();
  private reversePseudonymMaps = new Map<string, Map<string, string>>();

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

  setLiveSession(projectId: string, data: LiveSessionData | null): void {
    if (!data) {
      this.liveSessions.delete(projectId);
    } else {
      this.liveSessions.set(projectId, data);
    }
  }

  getLiveSession(projectId: string): LiveSessionData | undefined {
    return this.liveSessions.get(projectId);
  }

  getPseudonym(grantId: string, realParticipantId: string): string {
    let forward = this.pseudonymMaps.get(grantId);
    if (!forward) {
      forward = new Map();
      this.pseudonymMaps.set(grantId, forward);
    }
    let reverse = this.reversePseudonymMaps.get(grantId);
    if (!reverse) {
      reverse = new Map();
      this.reversePseudonymMaps.set(grantId, reverse);
    }
    const existing = forward.get(realParticipantId);
    if (existing) return existing;
    const pseudo = `p_${createHash("sha256")
      .update(`${grantId}:${realParticipantId}`)
      .digest("hex")
      .slice(0, 8)}`;
    forward.set(realParticipantId, pseudo);
    reverse.set(pseudo, realParticipantId);
    return pseudo;
  }

  resolvePseudonym(grantId: string, pseudoOrReal: string): string {
    const reverse = this.reversePseudonymMaps.get(grantId);
    return reverse?.get(pseudoOrReal) ?? pseudoOrReal;
  }

  proposeModeration(
    projectId: string,
    grantId: string,
    agentName: string,
    input: ProposeModerationInput
  ): ModerationProposal {
    const realParticipantId = input.participant
      ? this.resolvePseudonym(grantId, input.participant)
      : undefined;
    const proposal: ModerationProposal = {
      id: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      grantId,
      agentName,
      action: input.action,
      participantId: realParticipantId,
      reason: input.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const list = this.proposals.get(projectId) ?? [];
    list.push(proposal);
    this.proposals.set(projectId, list);
    return proposal;
  }

  getPendingProposals(projectId: string): ModerationProposal[] {
    return (this.proposals.get(projectId) ?? []).filter((p) => p.status === "pending");
  }

  getAllProposals(projectId: string): ModerationProposal[] {
    return this.proposals.get(projectId) ?? [];
  }

  decideProposal(
    proposalId: string,
    decision: "accepted" | "dismissed"
  ): ModerationProposal | null {
    for (const list of this.proposals.values()) {
      const found = list.find((p) => p.id === proposalId);
      if (found) {
        found.status = decision;
        found.decidedAt = new Date().toISOString();
        return found;
      }
    }
    return null;
  }
}

