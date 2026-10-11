import type { ProjectSnapshot } from "@decisionator/plugin-sdk";
import type { LiveGuestInfo } from "@decisionator/share-inpage";

export interface LiveParticipantProfile {
  participantId: string;
  name: string;
  isHost: boolean;
  online: boolean;
  gradeCount: number;
  hasBallot: boolean;
}

/**
 * Builds the participant roster for a live session.
 * Pure function following Data Model §8 and Contract §7.3.
 */
export function buildRoster(
  snapshot: ProjectSnapshot,
  guests: LiveGuestInfo[],
  hostParticipantId: string
): LiveParticipantProfile[] {
  const round = snapshot.project.voting?.round ?? 1;

  const participants = new Map<string, { name: string; online: boolean }>();

  // 1. Host
  participants.set(hostParticipantId, {
    name: "Host",
    online: true,
  });

  // 2. Connected guests
  for (const g of guests) {
    participants.set(g.participantId, {
      name: g.name || g.participantId,
      online: g.connections > 0,
    });
  }

  // 3. Snapshot authors (grades, rankings, comments, and history)
  const addFromEntry = (by: string, byName?: string) => {
    if (!by) return;
    const existing = participants.get(by);
    if (!existing) {
      participants.set(by, {
        name: byName || by,
        online: false,
      });
    } else if (byName && existing.name === by) {
      existing.name = byName;
    }
  };

  for (const g of snapshot.grades) addFromEntry(g.by, g.byName);
  for (const r of snapshot.rankings) addFromEntry(r.by, r.byName);
  for (const c of snapshot.comments) addFromEntry(c.by, c.byName);
  for (const g of snapshot.history?.grades ?? []) addFromEntry(g.by, g.byName);
  for (const r of snapshot.history?.rankings ?? []) addFromEntry(r.by, r.byName);

  const profiles: LiveParticipantProfile[] = [];

  for (const [id, info] of participants) {
    const isHost = id === hostParticipantId;
    const gradeCount = snapshot.grades.filter((g) => g.by === id).length;
    const hasBallot = snapshot.rankings.some((r) => r.by === id && (r.round ?? 1) === round);

    profiles.push({
      participantId: id,
      name: info.name,
      isHost,
      online: info.online,
      gradeCount,
      hasBallot,
    });
  }

  // Sort: Host first, then online guests, then offline participants (sorted by name)
  profiles.sort((a, b) => {
    if (a.isHost) return -1;
    if (b.isHost) return 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return profiles;
}
