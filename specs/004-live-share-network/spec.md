# Feature Specification: Live Sessions Across Devices

**Feature Branch**: `004-live-share-network` | **Created**: 2026-10-06 | **Status**: Implemented

**Input**: Review of the 002 in-page sharing implementation (User Story 4). The shipped version
only connected tabs of one browser, recorded every guest's vote as the host's (guests overwrote
the host and each other), ended when the host closed the dialog or changed page, produced
`localhost` links and had no QR code.

This feature completes 002 User Story 4 (FR-012 – FR-015, SC-003, SC-005) rather than adding a
new capability.

## User Scenarios & Testing

### User Story 1 - Guests on other devices join and vote (Priority: P1)

The owner starts a live session for a project; people in the room open the link or scan the QR
code on their own laptops and phones and grade, comment and rank options. Every contribution is
recorded under that person's name, and the owner's own votes stay intact.

**Independent Test**: Start a session in browser A, join from browser B on another device,
grade an option the owner already graded: the owner sees two ratings, B sees their own grade.

**Acceptance Scenarios**:

1. **Given** a live session, **When** a guest on another device opens the join link, **Then**
   they see the project within seconds and can grade, comment and rank.
2. **Given** an owner grade on an option, **When** two guests grade it, **Then** three grades
   exist, each attributed to its author.
3. **Given** a guest who reloads or briefly loses the network, **When** they reconnect, **Then**
   they keep the same identity and their earlier grades and ballot.
4. **Given** voting is closed, **When** a guest submits a ballot, **Then** it is refused with a
   clear message and nothing is recorded.

### User Story 2 - The owner keeps working while hosting (Priority: P1)

The session keeps running while the owner moves between the project's pages or closes the
session panel; a header indicator shows it is live and how many people are connected. It ends
only when the owner ends it or closes the tab.

### User Story 3 - Guests know whether their input counted (Priority: P2)

A guest is told when a change could not be saved (connection lost, host refused it, store
failed) and when the host ended the session, and can keep a copy of the final state.

### Edge Cases

- Host tab closes or reloads: guests see the session end (or, if the close message is lost,
  "reconnecting" and then "no longer reachable" after 2 minutes).
- Join link opened on a device that cannot reach the host's `localhost` address: the host is
  warned when the link is created and can enter a reachable address.
- Many guests submitting at once: no write is lost.
- A guest tries to vote as someone else, edit another person's comment, rank removed options or
  flood the host: refused.
- Live results switched off: guests do not see other people's ballots.
- Password-protected project: hosting requires unlocking it in the tab first; guest comments
  are stored encrypted like the owner's.
- Networks blocking peer connections: the owner can configure relays and a TURN server.

## Requirements

- **FR-001**: Guests on other devices and browsers MUST be able to join a live session by link
  or QR code without accounts or a project-specific server.
- **FR-002**: Every guest contribution MUST be recorded under a stable per-guest identity and
  display name; it MUST NOT overwrite the owner's or another guest's entries.
- **FR-003**: The host MUST validate guest submissions against the current project state and
  role, and confirm or refuse each one to the guest.
- **FR-004**: The session MUST survive navigation within the app and closing the session panel.
- **FR-005**: Project data and votes MUST travel only between the host's and the guests'
  browsers; any rendezvous service MUST see no project data and no session credentials.
- **FR-006**: Guests MUST be told when the host ends the session or becomes unreachable and be
  able to export their last view.
- **FR-007**: The rendezvous relays and ICE servers MUST be user-configurable.

## Success Criteria

- **SC-001**: A guest on a second device is connected within 10 s on a typical home or office
  network (direct or STUN-assisted connection).
- **SC-002**: 20 concurrent guests submitting at once lose no submissions (verified by test).
- **SC-003**: Updates reach all guests within 1 s of being saved.

## Assumptions

- Public Nostr relays (configurable) are acceptable as a zero-cost rendezvous for encrypted
  connection offers, in line with 002's assumption of "a lightweight public or local signaling
  coordinator".
- Some networks (symmetric NAT, strict firewalls) need a TURN server, which the user supplies.
