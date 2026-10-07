# Feature Specification: Personal Option Status and Plugin-Defined Option Properties

**Feature Branch**: `005-option-status-properties`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Add an additional optional property 'status' on each option, per
person. By default it is written automatically as 'seen' once the option has been displayed in
that person's viewport for 5 seconds; the duration can be changed (or the automatic marking
switched off) in Settings. Each plugin can define additional properties for options (the
per-person status is the first such property, delivered by a built-in plugin through the public
plugin API)."

## Clarifications

### Session 2026-10-07

- Q: Who can see a person's "Seen" marks? → A: By default only that person, shown like unread
  mail: options the person has not seen yet look different from the ones they have. The option
  card and the option detail view offer an interface that plugins can use to change how an
  option looks, including this marker.
- Q: Is "Seen" the only status? → A: Yes, for now: "not seen" and "Seen". Other statuses can
  come later as plugin properties.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which options I have not looked at yet (Priority: P1)

As a participant in a decision with many options, I want each option I have actually looked at
to be marked "Seen" for me automatically, so that I can find the options I have not considered
yet and grade every option, not just the first ones on the page.

An option counts as looked at once it has been on my screen for 5 seconds in a row. Options I
have not seen yet stand out the way unread mail does, with a stronger title and a "new" dot,
and I can show only those. Only I see my marks.

**Why this priority**: This is the user-visible value of the feature. Long option lists are
skimmed from the top, and the bottom options get fewer grades. On its own, this story delivers
the whole "status" request with the default behaviour.

**Independent Test**: Open a project with 12 options as Gina. Keep the first 3 options on screen
for 6 seconds, then scroll past options 4–6 in under a second each. Options 1–3 show "Seen";
options 4–12 show as new; the project shows "9 not seen yet". Showing only unseen options lists
options 4–12.

**Acceptance Scenarios**:

1. **Given** Gina opens the project for the first time, **When** the page loads, **Then** every
   option card and its detail view show the unseen marker (stronger title and a "new" dot,
   announced as "not seen" to screen readers), and the project shows "12 not seen yet".
2. **Given** option "Lisbon" is on Gina's screen, **When** it has stayed there for 5 seconds,
   **Then** it is marked "Seen" for Gina and the count drops to "11 not seen yet".
3. **Given** option "Alps lodge" is on Gina's screen, **When** she scrolls it away after
   4 seconds, **Then** it stays new; if she later keeps it on screen for 5 seconds without a
   break, it becomes "Seen".
4. **Given** option "Barcelona" is on Gina's screen, **When** she switches to another browser
   tab or window before 5 seconds have passed, **Then** the timer pauses and the option stays
   new.
5. **Given** Gina has seen "Lisbon", **When** Tom or the project owner opens the project,
   **Then** "Lisbon" is still new for them, and nothing in their view shows that Gina has seen
   it.
6. **Given** Gina has seen 3 options, **When** she opens the project on the same device the next
   day, **Then** those 3 are still "Seen".
7. **Given** 9 options are new for Gina, **When** she chooses to show only unseen options,
   **Then** exactly those 9 are listed, and each one leaves the list when it becomes "Seen".
8. **Given** Gina has seen "Lisbon", **When** she marks it as not seen, **Then** it shows as new
   again and is not marked "Seen" automatically until she leaves the page and comes back.
9. **Given** Gina joins a live session as a guest, **When** an option stays on her screen for
   5 seconds, **Then** it is marked "Seen" for her in that project, as for any other
   participant.

---

### User Story 2 - Decide how and whether options are marked automatically (Priority: P2)

As a participant, I want to change how long an option must stay on screen before it is marked
"Seen", or turn automatic marking off, so that the marking matches how I read and does not
happen when I do not want it.

**Why this priority**: The default of 5 seconds suits most people, so this is an adjustment, not
the core value. Being able to switch it off also matters for people who do not want their
viewing recorded.

**Independent Test**: In Settings, change the time to 10 seconds. An option kept on screen for
7 seconds stays new; at 10 seconds it becomes "Seen". Turn automatic marking off: an option kept
on screen for a minute stays new, and Gina can still mark it "Seen" herself.

**Acceptance Scenarios**:

1. **Given** Gina has not changed any settings, **When** she opens Settings, **Then** automatic
   marking is on, set to 5 seconds.
2. **Given** Gina sets the time to 10 seconds, **When** an option stays on her screen for
   7 seconds, **Then** it stays new; **When** it reaches 10 seconds, **Then** it is marked
   "Seen".
3. **Given** Gina enters 0 or 400 seconds, **When** she tries to save, **Then** she is told the
   time must be between 1 and 300 seconds, and the previous value stays.
4. **Given** Gina turns automatic marking off, **When** options stay on her screen for any
   length of time, **Then** none is marked "Seen" automatically.
5. **Given** automatic marking is off, **When** Gina marks "Lisbon" as seen herself, **Then**
   "Lisbon" shows "Seen".
6. **Given** Gina turned automatic marking off, **When** she later turns it on again, **Then**
   options she already marked keep their status and the rest are marked as she views them.

---

### User Story 3 - Plugins add their own properties to options (Priority: P2)

As a plugin author, I want my plugin to define extra properties for options, such as "Cost per
person" or "Shortlisted", so that people can record and see information that matters for their
kind of decision without the core product having to know about it.

The personal "Seen" status from User Story 1 is the first such property. It is provided by a
built-in plugin that uses only what any third-party plugin can use.

**Why this priority**: This is the extension point that makes User Story 1 possible under the
project's "everything is a module" principle, and it opens options to other plugins. It is not
visible to people until a plugin uses it, so it comes after the first visible property.

**Independent Test**: Enable a sample plugin that defines "Cost per person" (a number, one value
per option, set by the owner). The owner sets "Lisbon" to 420. Every participant sees "Cost per
person: 420" on "Lisbon". The value is in the project export, comes back on restore, and is
kept, but not shown, when the plugin is disabled. It is shown again when the plugin is
re-enabled.

**Acceptance Scenarios**:

1. **Given** a plugin defines "Cost per person" as a number for each option, **When** the owner
   opens "Lisbon", **Then** they can enter a cost, and the field is labelled "Cost per person".
2. **Given** the owner enters "abc" for "Cost per person", **When** they try to save, **Then**
   they are told a number is needed and nothing is saved.
3. **Given** "Lisbon" has "Cost per person: 420", **When** Gina opens "Lisbon", **Then** she sees
   "Cost per person: 420" and cannot change it.
4. **Given** a plugin defines "Shortlisted" as a yes/no value that each person sets for
   themselves, **When** Gina sets "Lisbon" to yes, **Then** "Lisbon" is shortlisted for Gina only.
5. **Given** two plugins each define a property named "Priority", **When** both are enabled,
   **Then** both properties are shown, each labelled with its plugin, and neither overwrites the
   other.
6. **Given** "Lisbon" has "Cost per person: 420", **When** the owner exports the project and
   restores it elsewhere with the plugin enabled, **Then** "Lisbon" still has
   "Cost per person: 420".
7. **Given** the plugin that defines "Cost per person" is disabled or removed, **When** the owner
   opens "Lisbon", **Then** the property is not shown. The value stays in the project and in
   exports, and it is shown again when the plugin is enabled.
8. **Given** a project contains a property value for a plugin this person does not have,
   **When** they open the project, **Then** it opens normally and the value is kept.
9. **Given** the built-in status plugin is disabled, **When** Gina views options, **Then** no
   "Seen" marks, new-option count or unseen filter are shown, and the rest of the app works as
   before.

---

### User Story 4 - Plugins change how options look (Priority: P2)

As a plugin author, I want to change defined parts of how an option looks, on its card and in
its detail view, so that my plugin can present its information (such as the unseen marker, a
cost badge or a "shortlisted" star) where people notice it, without forking the app.

**Why this priority**: The unseen marker from User Story 1 is delivered this way. Like User
Story 3, the extension point is what keeps the status feature a removable module, and it lets
other plugins present their properties well.

**Independent Test**: Enable a sample plugin that replaces the default unseen marker with a
blue left border, and adds a "€420" badge to the card of "Lisbon". Unseen cards show the blue
border instead of the dot; "Lisbon" shows the badge on its card and in its detail view. Grading,
commenting and voting on "Lisbon" work exactly as before. Disable the plugin: the default dot
comes back.

**Acceptance Scenarios**:

1. **Given** no plugin changes the unseen marker, **When** Gina views a new option, **Then** she
   sees the default marker (stronger title and a "new" dot) on its card and in its detail view.
2. **Given** a plugin replaces the unseen marker with a blue left border, **When** Gina views a
   new option, **Then** she sees the blue border and not the dot, on the card and in the detail
   view.
3. **Given** a plugin adds a badge to option cards, **When** Gina views "Lisbon", **Then** the
   badge appears in the card's badge area, next to badges from other plugins, in plugin order.
4. **Given** a plugin adds a section to the option detail view, **When** Gina opens "Lisbon",
   **Then** the section appears below the option's own content and above comments.
5. **Given** a plugin tries to hide or replace the title, the grade control, comments or the
   ballot, **When** Gina views "Lisbon", **Then** those still appear and work, and the plugin's
   change to them is ignored.
6. **Given** two enabled plugins both replace the unseen marker, **When** Gina opens Settings,
   **Then** she can choose which one is used; until she chooses, the one enabled first is used.
7. **Given** a plugin's part of the card fails to display, **When** Gina views "Lisbon", **Then**
   the card shows the default for that part with a short "a plugin could not display here"
   note, and the rest of the card works.
8. **Given** the plugin is disabled, **When** Gina views options, **Then** every part it changed
   goes back to the default at once, with no reload.

---

### Edge Cases

- An option taller than the screen: it counts as on screen while it fills at least half of the
  visible area.
- Several options on screen at once: each is timed on its own; all of them can become "Seen" at
  the same moment.
- A removed option that is restored: it keeps the status it had for each person before removal.
- Options shown in a compact list, the voting ballot or the results view count the same as the
  main option list. A title that appears only inside another text (a comment, an outcome
  explanation) does not count.
- A person viewing a shared project without a recognised identity (for example, a view-only
  link with no sign-in): nothing is recorded and no "Seen" marks are shown.
- Automatic marking while offline: marks are kept and saved when the person is back online.
- Many participants marking options at once: the owner's project-sharing limits are respected;
  marks may be grouped and saved a few seconds later, but none is lost.
- A plugin property value that does not match its declared type (for example, after the plugin
  changed its definition): it is shown as invalid to people who can edit it and ignored
  elsewhere, never silently converted.
- A plugin defines a property with the same name as one of the built-in option fields (title,
  description, status, tags): it is still kept separate, under its plugin's label.

## Requirements *(mandatory)*

### Functional Requirements

**Personal option status**

- **FR-001**: Each option MUST be able to carry a personal status for each participant, kept
  separately per participant. The values are "not seen" (the default when nothing is recorded)
  and "Seen".
- **FR-002**: An option MUST be marked "Seen" for a participant automatically once it has been
  on that participant's screen without a break for the configured time (default 5 seconds),
  while automatic marking is on.
- **FR-003**: The timer MUST pause while the page is not visible to the participant (another
  tab, window minimised, screen locked), and MUST reset when the option leaves the screen.
- **FR-004**: Participants MUST see which options are new to them, how many are new, and be able
  to show only new options. By default a new option MUST be shown like unread mail, on its card
  and in its detail view: a stronger title and a "new" dot. The marker MUST NOT rely on colour
  alone and MUST be announced to screen readers.
- **FR-005**: Participants MUST be able to mark an option as seen or not seen themselves. A
  manual "not seen" MUST NOT be overwritten automatically during the same page visit.
- **FR-006**: A participant's "Seen" marks MUST be visible only to that participant. Neither
  the owner nor other participants see them, in the app, in shared views or in the live session.
- **FR-007**: Personal status MUST NOT affect grades, ballots or outcomes.
- **FR-008**: Participants MUST be able to set the time an option must stay on screen (1 to 300
  seconds, whole seconds) and switch automatic marking off and on, in Settings. These are
  personal settings that apply to every project for that participant.
- **FR-009**: Personal statuses MUST be recorded for live-session guests the same way as for
  other participants, under the guest's identity.
- **FR-010**: "not seen" and "Seen" MUST be the only status values in this feature.

**Plugin-defined option properties**

- **FR-011**: A plugin MUST be able to declare additional option properties, each with a label,
  a value type (text, number, yes/no, a choice from a fixed list, or a date), an optional
  default and a scope. The scope is either one shared value per option or one value per person
  per option.
- **FR-012**: A shared property MUST be editable only by the project owner and by agents the
  owner has invited. A per-person property MUST be editable only by that person.
- **FR-013**: Values MUST be checked against the declared type before they are saved; invalid
  values MUST be refused with a message naming the property and the expected type.
- **FR-014**: Each property MUST belong to its plugin; properties from different plugins MUST
  NOT clash even when their names are the same.
- **FR-015**: Property values MUST be included in project export and restored on import, with
  their plugin and scope.
- **FR-016**: Disabling or removing a plugin MUST hide its properties without deleting their
  values. A project MUST open normally when it holds values from plugins that are not
  installed.
- **FR-017**: Property values MUST be readable, and settable within FR-012's limits, through the
  agent API, with the same checks as in the app. Values an agent sets MUST be attributed to that
  agent.
- **FR-018**: The personal "Seen" status MUST be provided by a built-in plugin that uses only the
  public plugin interface for option properties. Disabling it MUST remove all status display
  and marking (FR-001 – FR-010) without affecting anything else.
- **FR-019**: Changes to these plugin interfaces (option properties and option view) MUST be
  versioned so that plugins built for an older version keep working, or are refused with a
  plain-language reason.

**Option view extension**

- **FR-020**: The option card and the option detail view MUST offer defined places that plugins
  can change:
  - on the card: the unseen marker, the badge area and the footer;
  - in the detail view: the unseen marker, the property section and additional sections
    (below the option's content, above comments).
- **FR-021**: In each place a plugin MAY add content or replace the default presentation, given
  the option and what the viewing participant is allowed to see.
- **FR-022**: Plugins MUST NOT hide, cover or replace the option's title, grade control,
  comments or ballot. Changes aimed at them MUST be ignored.
- **FR-023**: When several plugins add to one place, all additions MUST be shown, in plugin order.
  When several replace one place, the participant MUST be able to choose which one is used in
  Settings; the default is the plugin enabled first.
- **FR-024**: If a plugin's part fails to display, that place MUST fall back to the default with a
  short notice, and the rest of the option MUST keep working.
- **FR-025**: Content added by plugins MUST meet the same accessibility level as the rest of the
  app (keyboard reachable, readable by screen readers, sufficient contrast).
- **FR-026**: The built-in status plugin MUST draw its default unseen marker only through this
  interface (FR-020 – FR-021).

### Key Entities

- **Option property definition**: Declared by a plugin. It has a name unique within that plugin,
  a label, a value type, an optional list of allowed choices, an optional default, a scope
  (shared or per person) and the plugin it belongs to.
- **Option property value**: The value of one property for one option. For a per-person property,
  it also names the participant. It records who set it and when. Like other project entries, a
  newer value replaces an older one from the same author without erasing history.
- **Personal option status**: A per-person property defined by the built-in status plugin, with
  the values "not seen" (implicit) and "Seen". It records whether it was set automatically or by
  hand.
- **Option view place**: A named part of the option card or detail view that plugins may add to
  or replace (unseen marker, badge area, footer, property section, additional sections). It
  has a default presentation.
- **Automatic marking setting**: Per participant. It holds on/off and a time on screen in
  seconds (default on, 5 s).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An option kept on screen for the configured time is shown as "Seen" within
  1 second after that time; an option kept on screen for less than the configured time is never
  marked automatically.
- **SC-002**: In a project with 30 options, a participant can find and open the first option
  they have not seen yet in 2 actions or fewer.
- **SC-003**: Marking options as seen adds no noticeable delay to scrolling or grading: with 100
  options on a mid-range phone, scrolling stays smooth and a grade still shows within 1 second.
- **SC-004**: A third-party plugin can add a new option property, and have it shown, checked,
  exported and restored, without any change to the core product.
- **SC-005**: 100% of property values survive export → restore and disable → re-enable of their
  plugin.
- **SC-006**: A third-party plugin can replace the unseen marker or add a card badge without any
  change to the core product, and with that plugin enabled, 100% of the grading, commenting and
  voting tests still pass.
- **SC-007**: In decisions with 10 or more options, the share of options that receive grades from
  every participant is higher than without the feature (measured in usability testing).

## Assumptions

- The existing option lifecycle field (active, proposed, removed), which the owner controls, is
  unchanged. The new personal status is separate and is labelled "Seen" in the app so the two
  are not confused.
- "On screen" means at least half of the option's card is visible, or the card fills at least
  half of the visible area when it is taller than the screen.
- Personal statuses are stored with the project, like grades, so they follow the participant
  across devices only where their identity does. Live-session guests keep them per device.
- Settings for automatic marking are kept per participant on their device. The project owner
  cannot override them.
- Plugin-defined properties are shown in the option detail view's property section and, where the
  plugin asks for it, as a badge on the option card (User Story 4). Nothing appears unless a
  plugin is enabled. The fixed core controls keep the primary flow intact (Constitution III).
- Per-person property values from any plugin are visible only to the person they belong to, like
  "Seen" marks. Showing them to others would need its own spec.
- Decision strategies may read property values in a later feature. Using properties in
  strategies, sorting or filtering by plugin properties (other than the unseen filter) is out of
  scope here.
- Stores with request limits (shared spreadsheets) may save status marks in batches a few seconds
  apart, within the existing request budget.
