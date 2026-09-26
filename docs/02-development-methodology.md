# Development Methodology

## Vertical Slice Strategy

### 1. The Pizza Principle

This project will be developed as a sequence of **vertical slices**.

The complete platform is the "whole pizza."

Each development iteration implements one narrow, coherent "slice" of that pizza.

A slice should extend through the entire application stack:

**User interface → application logic → API → domain logic → persistence → realtime/integration infrastructure where required**

A slice is not complete until the functionality is genuinely usable end-to-end.

---

# 2. Architecture First, Implementation Incrementally

The complete architectural specification describes the destination.

It does **not** mean that all described functionality should be implemented immediately.

The architectural specification exists so that decisions made while implementing an early slice do not unnecessarily prevent later slices.

The implementation should therefore follow this principle:

> **Think broadly. Build narrowly.**

Cursor should understand the larger domain before implementing each slice, but should implement only the functionality explicitly included in the current slice.

---

# 3. Do Not Build the Future

Do not implement infrastructure merely because a future requirement will eventually need it.

Do not create:

- unused database tables
- unused API endpoints
- speculative services
- unused UI screens
- generic frameworks for hypothetical future requirements
- configuration systems before configuration is actually needed
- generalized rules engines merely because future requirements may become complex
- abstractions whose only justification is that "we might need them someday"

Future requirements should influence **architectural boundaries**, but should not automatically produce future functionality.

---

# 4. Forward-Compatible Does Not Mean Fully Implemented

An early implementation should be designed so that later functionality can be added without destructive architectural changes.

For example:

If the first slice needs only a basic sortie, the implementation should not build the entire eventual sortie lifecycle.

However, the basic sortie should be modeled as a genuine domain object rather than as a temporary UI structure that would have to be discarded later.

Similarly:

- A first routing implementation should be behind a sensible boundary if routing will eventually have multiple providers.
- A first company implementation should respect multi-tenancy even if only one company exists initially.
- A first driver implementation should not assume that a driver can belong to only one company.
- A first calendar implementation should not assume that calendar entries are merely static appointments.
- A first location implementation should not make the driver's current GPS position synonymous with vehicle identity.

The goal is **structural foresight without functional overbuilding**.

---

# 5. Every Slice Must Be End-to-End

A slice should preferably produce something a real user can do.

For example, a hypothetical slice might be:

> A driver can sign in, see a sortie assigned to them, commence the sortie, see navigation, and complete the sortie.

That slice may require:

### Mobile

- Authentication screen
- Driver screen
- Sortie display
- Commence action
- Navigation
- Completion action

### Backend

- Authentication
- Driver identity
- Sortie retrieval
- Commencement command
- Completion command

### Database

Only the persistence necessary to support those capabilities.

### Realtime

Only if required by the slice.

### History

Only the events necessary to preserve the implemented behavior.

The slice should be fully functional rather than building isolated pieces of a much larger system.

---

# 6. Slice Selection

Before beginning a slice, explicitly define:

### User capability

What can a real user do after this slice exists?

### Actors

Which users participate?

### Domain objects

Which domain entities are genuinely required?

### State transitions

What states can actually change?

### Interfaces

Which mobile/web screens are required?

### Backend

Which API/domain operations are required?

### Persistence

Which data must actually be stored?

### Realtime

Is realtime genuinely necessary?

### Acceptance criteria

How do we know the slice works?

Anything outside those boundaries should remain unimplemented unless it is required to make the slice function correctly.

---

# 7. Slice Dependencies

Slices should be developed in dependency order where practical.

A later slice may depend upon concepts introduced by an earlier slice.

However, a future slice should not cause its entire dependency tree to be implemented prematurely.

Implement the smallest useful dependency necessary to support the current slice.

---

# 8. Architectural Decision Discipline

During implementation, Cursor will inevitably encounter decisions not fully specified by the current slice.

Use this decision hierarchy:

### First

Respect the established architectural specification.

### Second

Respect existing implemented domain invariants.

### Third

Choose the smallest implementation that satisfies the current slice.

### Fourth

Ensure the decision does not unnecessarily prevent foreseeable future slices.

### Fifth

If a decision has significant architectural consequences and cannot be resolved confidently, record it as an open architectural decision rather than inventing a large framework.

---

# 9. Avoid Premature Generalization

Do not create a generalized abstraction merely because two hypothetical future features might someday share behavior.

Generalize when:

- the shared concept is already established in the domain,
- multiple implemented features actually require it,
- or the abstraction is necessary to preserve an established architectural boundary.

Do not generalize solely on speculation.

---

# 10. Preserve the Domain Model

Although implementation is incremental, the domain model must remain coherent.

For example, do not create a temporary concept such as:

`TaxiJob`

when the established domain concept is:

`Sortie`

simply because the first slice happens to concern taxi work.

Likewise, do not create:

`AirportTaxiQueue`

as a core domain concept merely because a later slice will eventually implement an airport protocol.

The current slice may implement a narrow version of the broader concept, but it should use the correct conceptual vocabulary.

---

# 11. One Slice at a Time

At the beginning of each development iteration, explicitly establish:

> **CURRENT SLICE**

Cursor should treat that section as the current implementation scope.

The broader architecture provides context.

The current slice provides the implementation boundary.

Do not begin implementing another slice merely because its requirements are already known.

---

# 12. Definition of Done

A slice is complete when:

1. The feature works end-to-end.
2. The frontend works against the real backend.
3. Persistence works.
4. Relevant authorization works.
5. Relevant error states work.
6. Relevant history/state transitions are recorded.
7. The implementation has been tested.
8. The application can be run in the intended development environment.
9. No speculative future functionality was added merely because it was described in the architectural specification.
10. The resulting architecture remains compatible with the broader specification.

A partially implemented collection of future features is not preferable to one complete working slice.

---

# 13. The Architecture Should Evolve

The architectural specification is versioned.

As implementation reveals information that was not apparent during requirements analysis, the architecture may be revised.

When a new slice exposes a genuine domain requirement that conflicts with an existing architectural assumption:

1. Stop.
2. Identify the conflict.
3. Update the architectural specification.
4. Record the decision.
5. Then continue implementation.

Do not silently distort the domain model merely to preserve an earlier implementation.

---

# 14. The Pizza Rule

At any point in development, it should be possible to answer:

> "Which slice are we building right now?"

The answer should identify one coherent user capability.

The team should be able to demonstrate that slice working from beginning to end.

The existence of requirements for future slices should not cause those slices to be partially implemented today.

The guiding principle is:

> **Build a complete slice, then build the next slice.**

Not:

> **Build the entire foundation first, then eventually make it usable.**

And not:

> **Build fragments of every future feature simultaneously.**

The goal is a sequence of small, working increments that progressively assemble the complete platform.