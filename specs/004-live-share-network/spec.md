# Feature Specification: Live Sessions Across Devices

**Feature Branch**: `004-live-share-network` | **Created**: 2026-10-06 | **Revised**: 2026-10-07 |
**Status**: Implemented; revision gaps tracked in [tasks.md](./tasks.md)

**Input**: Review of the 002 in-page sharing implementation (User Story 4). The shipped version
only connected tabs of one browser, recorded every guest's vote as the host's (guests overwrote
the host and each other), ended when the host closed the dialog or changed page, produced
links that worked only on the host's own computer and had no QR code.

This feature completes 002 User Story 4 (FR-012 – FR-015, SC-003, SC-005) rather than adding a
new capability.

## User Scenarios & Testing

### User Story 1 - Everyone in the room votes from their own device (Priority: P1)

As a project owner running a decision with people in the room, I want everyone to give their
input from their own laptop or phone, so that the outcome counts every participant's grades,
comments and ballot, each under their own name, and no one's input overwrites anyone else's.

**Independent Test**: The owner grades option "Ramen" 5 stars and starts a session in browser A.
Gina joins from browser B on another device and grades "Ramen" 2 stars. Both see
"3.5 avg · 2 ratings"; the owner's grade is still 5 and Gina's is 2.

**Acceptance Scenarios**:

1. **Given** a live session, **When** Gina opens the join link or scans the QR code on another
   device and enters her name, **Then** within 10 s she sees the project and can grade, comment
   and rank.
2. **Given** the owner graded "Ramen" 5 stars, **When** Gina grades it 2 and Tom grades it 4,
   **Then** three grades exist, attributed to the owner, Gina and Tom, and the average is
   (5 + 2 + 4) / 3 = **3.7**.
3. **Given** Gina posted the comment "Ramen please", **When** the owner opens the comments on
   "Ramen", **Then** the comment is shown under the name "Gina".
4. **Given** Gina graded "Ramen" 2 and submitted a ballot, **When** she reloads the page or loses
   the network for less than 2 minutes and reconnects on the same device, **Then** she is still
   "Gina", her grade is 2 and her ballot is unchanged.
5. **Given** Gina is connected as "Gina", **When** a second guest on another device joins with
   the name "Gina", **Then** the second guest joins as "Gina 2", sees "You're Gina 2", and the
   owner's list of connected people shows both "Gina" and "Gina 2".
6. **Given** the owner closed voting, **When** Gina submits a ballot, **Then** she sees "Voting is
   closed." and no ballot is recorded; she can still grade and comment.
7. **Given** 64 devices are connected, **When** a 65th guest opens the join link, **Then** they
   see "This session is full." and are not connected.

### User Story 2 - The owner runs the meeting while hosting (Priority: P1)

As a project owner hosting a live session, I want to keep working in the project (grade,
comment, check results, open and close voting) without disconnecting anyone, so that I can run the
meeting from one tab and the session ends only when I decide to end it.

**Independent Test**: With Gina connected, the owner hides the session panel, goes to the
Results page and back to the project. Gina stays connected throughout and her ballot submitted
in between is recorded.

**Acceptance Scenarios**:

1. **Given** Gina is connected, **When** the owner hides the session panel and moves between the
   project's pages, **Then** Gina stays connected and the owner can always see that the session
   is live with "1 connected".
2. **Given** Gina and Tom are connected, **When** the owner reopens the session panel, **Then**
   it lists "Gina" and "Tom" as connected, with the join link and QR code.
3. **Given** Gina is connected, **When** the owner closes voting, **Then** within 1 s Gina's
   ballot is locked with "Voting is closed." and she can still grade options.
4. **Given** Gina is connected, **When** the owner tries to close or reload the tab, **Then** the
   browser asks the owner to confirm leaving; if the owner confirms, Gina is told "The host
   closed their tab."
5. **Given** Gina is connected, **When** the owner ends the session, **Then** Gina is told "The
   host ended the session." and can no longer change anything.

### User Story 3 - Guests know whether their input counted (Priority: P2)

As a guest, I want to be told right away whether each grade, comment or ballot was saved, and
when the session has ended, so that I never leave thinking my input counted when it did not,
and I keep a record of what I last saw.

**Independent Test**: Gina grades "Tacos" just after the owner removed it, before her page
updates. She sees "Not saved: That option is no longer available." and the grade disappears.
The owner then ends the session; Gina saves a copy, and the file opens in Deci as a project
with her grade and comment in it.

**Acceptance Scenarios**:

*Feedback on each change*

1. **Given** Gina is connected, **When** she grades "Ramen" 4, **Then** the grade shows at once
   and stays at 4 once the host confirms it.
2. **Given** the host refuses or cannot save Gina's grade, **When** the refusal arrives, **Then**
   Gina sees "Not saved" with the reason, and her grade returns to its previous value.
3. **Given** Gina lost the connection, **When** she tries to grade or comment, **Then** the
   controls are disabled with "Not connected to the host, so changes can't be saved right now."
4. **Given** Gina submits 30 changes within one second, **When** the host's limit is reached,
   **Then** the extra changes show "Too many changes at once. Try again shortly." and none of the
   accepted ones are lost.

*Session end and a record of it*

5. **Given** the owner ended the session, **When** Gina looks at her page, **Then** she sees "The
   host ended the session. This is the last state you received." and a "Save a copy" action.
6. **Given** the owner's tab disappeared without saying goodbye, **When** 2 minutes pass without
   reaching it, **Then** Gina sees "The host is no longer reachable." with "Reconnect" and "Save a
   copy" actions.
7. **Given** the session ended, **When** Gina saves a copy, **Then** she gets a project file that
   Deci can open, holding the options, grades, comments and results she could see. It holds no
   hidden comment text, and no other people's ballots if live results were off.

### Edge Cases

- The join link points to an address only the owner's computer can reach: the owner is warned
  when the link is created and can enter an address other devices can reach.
- Many guests submitting at once: no write is lost (SC-002).
- A guest tries to vote as someone else, edit another person's comment, grade or rank a removed
  option, or rank one option twice: refused with a message, nothing recorded.
- Live results switched off: guests see only their own ballot until voting closes.
- Password-protected project: the owner must unlock it in the tab before hosting; guest
  comments are stored encrypted like the owner's.
- Networks that block direct device-to-device connections: the owner can configure their own
  connection services in Settings (FR-009).
- Owner and guest run different versions of Deci: the guest is told "The host is running a
  different version of Deci. Reload both pages."

## Requirements

- **FR-001**: Guests on other devices and browsers MUST be able to join a live session by link
  or QR code without accounts or a project-specific server.
- **FR-002**: Every guest contribution MUST be recorded under a stable per-guest identity and
  display name; it MUST NOT overwrite the owner's or another guest's entries.
- **FR-003**: Two connected guests MUST NOT share a display name; a repeated name gets the
  lowest free number appended ("Gina 2"), kept for that guest for the rest of the session.
- **FR-004**: The host MUST check every guest submission against the current project state and
  the guest's role, and confirm or refuse each one to the guest with a reason.
- **FR-005**: The session MUST stay up while the owner moves within the app and hides the
  session panel. It MUST end only when the owner ends it or closes or reloads the tab, and the
  owner MUST be asked to confirm closing while guests are connected.
- **FR-006**: The owner MUST be able to see who is connected; a guest who closes their tab
  MUST leave that list at once.
- **FR-007**: Project data and votes MUST travel only between the owner's and the guests'
  browsers. Any service that helps them find each other MUST see no project data and no session
  credentials.
- **FR-008**: Guests MUST be told when the host ends the session or cannot be reached, and MUST
  be able to save their last view as a project file Deci can open.
- **FR-009**: The services used to find and connect devices MUST be configurable by the owner.

## Success Criteria

- **SC-001**: A guest on a second device is connected within 10 s on a typical home or office
  network.
- **SC-002**: 20 guests submitting at the same moment lose no submissions (verified by test).
- **SC-003**: Updates reach all guests within 1 s of being saved.

## Assumptions

- A guest's identity is tied to their device and browser. The same person joining from a second
  device takes part as a second guest.
- The owner cannot remove a connected guest; to stop all input they end the session. Removing a single guest is out of scope.
- Free public meeting-point services (configurable) are acceptable for finding the owner's
  browser, provided they only ever see encrypted connection offers. This follows 002's
  assumption of "a lightweight public or local signaling coordinator".
- Some networks need a relay service for the connection itself, which the owner supplies.
- At most 64 devices can connect to one session.
