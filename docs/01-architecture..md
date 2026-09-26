# Ground Operations Platform

## Architectural Specification — v0.1

### Status

**Purpose:** Foundational product, domain, and architectural specification for implementation with Cursor AI IDE.

**Initial customer:** Flagship taxi company.

**Architectural objective:** Build a multi-tenant SaaS platform for professional ground-driving operations without making taxi operations, airport operations, or the flagship company's particular business practices fundamental assumptions of the platform.

---

# 1. Product Definition

The platform is a SaaS system for organizations that operate fleets of human-driven ground vehicles.

The initial implementation is for a taxi company, but the core architecture must support other professional ground-driving businesses, including passenger transportation, delivery, equipment/supply transportation, and related operations.

The platform coordinates:

* Companies
* Human drivers
* Vehicles
* Fleets
* Sorties
* Scheduling
* Dispatch
* Facilities and facility-imposed operational protocols
* Location observations
* Routing
* Traffic information
* Driver availability and duty state
* Operational history
* External and automated sources of work

The platform must not make "taxi" a fundamental domain concept unless taxi-specific behavior is explicitly represented as company configuration or a particular sortie type.

---

# 2. Architectural Principles

## 2.1 Sorties are the central operational unit

A **sortie** is a discrete operational task performed by a driver using a vehicle.

Examples include:

* Passenger transportation
* Flight-crew transportation
* Food delivery
* Equipment pickup/dropoff
* Supply transportation
* Other professional driving tasks

A sortie is an independent domain object. It is not merely a calendar event.

A sortie has its own:

* Identity
* Type
* Required data
* Lifecycle
* Assignment
* Responsibility
* Routing
* Schedule
* Operational history
* Location history
* Communication history
* Completion state

---

## 2.2 The platform must separate universal concepts from customer-specific behavior

The platform should provide stable domain primitives and extensible configuration.

The flagship company's business rules must not be hard-coded into universal domain objects when those rules are actually company-specific.

For example:

> "Drivers occupying positions 1 and 2 in an airport queue are unavailable for dispatch."

is not a universal definition of driver availability.

Instead:

* The facility protocol determines that a driver occupies queue position 1 or 2.
* The company's configuration determines that those positions make the driver unavailable for dispatch.

---

## 2.3 The platform is multi-tenant from the beginning

Multiple companies operate independently within the same platform.

Company data, authorization, visibility, configuration, and operational relationships must be tenant-aware.

A driver may have operational relationships with multiple companies simultaneously.

Company association represents **operational authorization and relationship**, not necessarily employment.

---

## 2.4 Server-authoritative architecture

The server is authoritative for operational state.

Clients may:

* Request actions
* Report observations
* Display state
* Provide explicit human confirmation

but clients must not independently establish authoritative operational state.

A useful conceptual flow is:

**Client action/observation → server processing → authoritative state → event/history → realtime propagation**

---

## 2.5 Human actions and system inference are different things

The system should avoid burdening drivers with data entry when reliable information can be inferred from:

* GPS
* Routing
* timestamps
* existing schedule information
* facility state
* other system observations

However, when human intent cannot reasonably be inferred, an explicit human action should be retained.

The system must distinguish:

**Observed fact**

from

**System inference**

from

**Human assertion**

from

**Derived operational state**

---

# 3. Core Domain Entities

The initial domain model should include concepts equivalent to the following.

## 3.1 User

Represents a human identity.

A user may have one or more operational relationships with companies.

Users may have different capabilities or roles, including:

* Driver
* Dispatcher
* Fleet manager
* Company manager
* Customer-service personnel
* Other platform-supported roles
* Platform administrator

The role vocabulary is platform-controlled.

Companies configure which capabilities their roles receive, but companies do not arbitrarily invent platform roles.

---

## 3.2 Company

Represents an organization operating within the platform.

A company:

* Owns or operates vehicles
* Has drivers associated with it
* Configures company-specific operational behavior
* Creates and receives sorties
* Participates in facility protocols
* Has company-specific retention/configuration policies

The company is the primary organizational/business boundary.

---

## 3.3 Driver

Represents a human who can perform driving operations.

A driver may belong to multiple companies simultaneously.

Driver/company relationships are many-to-many-capable.

The platform should not assume:

* employment
* exclusivity
* permanent vehicle assignment
* permanent fleet assignment

unless a particular company configuration establishes those conditions.

---

## 3.4 Vehicle

Represents a physical vehicle.

A vehicle has:

* Capabilities
* Restrictions
* Company relationship
* Potential fleet relationship
* Assignment history

A driver may operate multiple vehicles.

A vehicle may be used by multiple drivers.

Vehicle assignment is company-controlled.

The driver does not arbitrarily assign themselves a vehicle.

---

## 3.5 Fleet

Represents a logical grouping of vehicles and/or operational resources.

The architecture must permit companies to use:

* One fleet containing multiple vehicle types
* Multiple fleets
* Other supported fleet organizations

Vehicle purpose/type and fleet membership are distinct concepts.

---

## 3.6 Facility

Represents an external physical organization/location that imposes operational procedures on participating drivers.

Examples include:

* Airports
* Hotels
* Passenger terminals
* Other facilities

A facility may have one or more operational protocols.

The platform team configures facility protocols through the concierge model.

Facilities do not initially receive a self-service configuration console.

---

## 3.7 Operational Protocol

Represents an externally governed operational process.

A protocol can define concepts such as:

* Operational areas
* Geofences
* Queue positions
* Capacity
* State transitions
* Participant states
* Signals
* Driver actions
* System observations
* Protocol enforcement

A single protocol can apply to multiple companies.

A company can participate in multiple protocols.

The platform implements the protocol; the facility owns the real-world business process.

---

# 4. Sorties

## 4.1 Sortie creation

A sortie may originate from many sources.

Potential sources include:

* Driver
* Dispatcher
* Company
* Automated telephone system
* AI-assisted telephone workflow
* Customer web booking
* External API
* Future integrations

The creation source is **provenance**, not a fundamental distinction in the sortie itself.

All validated sources ultimately produce the same core domain object: a sortie.

---

## 4.2 Draft sorties

Some creation channels produce a draft before authoritative creation.

Example:

**Telephone conversation → transcription → AI extraction → draft sortie → validation → authoritative sortie**

A draft may contain:

* Customer
* Telephone number
* Pickup
* Destination
* Date
* Time
* Passenger information
* Service requirements
* Estimated cost
* Other sortie-type fields

Drafts may be displayed and updated in realtime.

AI-generated data must not automatically become authoritative merely because an AI system produced it.

---

## 4.3 Sortie type

Sortie types are platform-defined.

The platform determines:

* Available sortie types
* Schema
* Required fields
* Supported capabilities
* Required qualifications
* Other structural requirements

Companies are enabled for platform-defined sortie types through concierge configuration.

Companies do not create arbitrary custom fields.

If a company is enabled for a sortie type, the complete defined schema is available according to platform rules.

---

# 5. Assignment and Responsibility

A sortie may initially be unassigned.

Once a driver accepts responsibility for a sortie, it has exactly one responsible driver.

No driver becomes responsible merely because another person attempted to assign the sortie to them.

Acceptance is the universal gate for responsibility.

---

## 5.1 Driver-to-driver transfer

A driver may:

1. Create a sortie.
2. Offer it to another driver.
3. The receiving driver accepts or rejects.
4. Responsibility transfers only upon acceptance.

The original driver remains responsible until another driver accepts.

A committed driver cannot simply abandon a sortie.

They may request/perform a transfer.

---

## 5.2 Open offers

A sortie may be offered to:

* One driver
* Multiple drivers
* All eligible available drivers
* Other supported candidate groups

If multiple drivers receive the same offer, the first valid acceptance atomically claims the sortie.

Other acceptance attempts must fail safely.

---

## 5.3 Cross-company sorties

A sortie may cross company boundaries.

Example:

Company A creates a sortie.

Driver A accepts it.

Driver A transfers it to Driver B at Company B.

Driver B accepts it.

The sortie remains associated with its original company of record while operational responsibility belongs to Driver B.

The system must preserve the complete transfer history.

---

# 6. Company Assignments

A company may directly assign future work to a driver.

Example:

A flight-crew transportation sortie may be assigned approximately two days before execution.

The system must check at assignment time:

* Driver eligibility
* Vehicle eligibility
* Required capabilities
* Existing schedule
* Travel feasibility
* Other known constraints

These checks should occur even when the sortie is far in advance.

As the execution date approaches, the system should continue recalculating as relevant variables change.

---

## 6.1 Commitment strength

A company may define assignments as strong commitments.

The flagship company's flight-crew assignments are an example.

The driver may technically reject the assignment.

The system records the rejection and initiates whatever company-defined operational workflow follows.

The platform must not encode "mandatory" as an absolute physical prohibition against human action.

---

# 7. Sortie Lifecycle

The platform must support a lifecycle with concepts broadly equivalent to:

**Draft → Created → Offered/Assigned → Accepted → Commenced → In Progress → Completed**

However, sortie lifecycle details are company-configurable subject to platform invariants.

The platform must maintain universal invariants such as:

* An accepted/active sortie has one responsible driver.
* Completion is explicit.
* Significant state changes are historically recorded.
* Responsibility changes require an explicit valid transition.
* Cancellation requests do not necessarily constitute immediate cancellation.

---

# 8. Driver Interaction Model

The driver's operational workflow should be deliberately minimal.

The fundamental sortie interaction is:

**Commence → Navigate → Complete**

The driver should not be required to manually enter operational information that the system can reasonably infer.

---

## 8.1 Commencement

When a driver commences a sortie:

1. The driver explicitly signals commencement.
2. The server records the commencement.
3. Navigation is presented on the driver's device.
4. GPS observations continue.
5. The system begins reconstructing actual movement.

The navigation experience provides a practical incentive for the driver to explicitly commence the sortie.

---

## 8.2 Pickup inference

The driver does not need to manually report:

* Passenger arrival
* Passenger entry
* Waiting start
* Waiting end
* Departure

The system can infer these events from:

* GPS
* Arrival at pickup
* Duration at pickup
* Vehicle departure

For example:

> Driver arrived at pickup at 2:28 PM.

> Vehicle remained at pickup until approximately 2:32 PM.

> Pickup completion is therefore inferred to have occurred by approximately 2:32 PM.

The system must not pretend to know the exact passenger-entry time when it does not.

---

## 8.3 Completion

Completion is an explicit driver action.

The system may gently prompt a driver who appears to have reached the final destination but has not completed the sortie.

GPS alone does not automatically complete the sortie.

---

# 9. Scheduling and Calendar

The driver calendar is a central operational system.

It may contain:

* Sorties
* Dispatch shifts
* Duty shifts
* Vehicle assignments
* Other operational commitments

Redundant static relationships should not necessarily appear as calendar events.

For example, a driver who permanently uses the same vehicle does not need repetitive vehicle-assignment events.

---

## 9.1 Dynamic scheduling

The schedule is not merely a list of appointments.

Feasibility must consider:

* Time
* Geography
* Routing
* Traffic
* Current location
* Current activity
* Future activity
* Vehicle assignment
* Driver capabilities
* Sortie requirements
* Facility protocols
* Waiting periods
* Other relevant variables

---

## 9.2 Progressive recalculation

Scheduling resolution should be progressive.

Near-term schedules should receive:

* High-frequency recalculation
* Detailed routing
* Traffic-aware estimates

Distant schedules may use:

* Lower-frequency recalculation
* General estimates

Significant changes should trigger broader recalculation.

---

# 10. Schedule Margins

The system should expose operational margins, not merely a binary feasible/infeasible result.

Examples:

> **Point A**
> Required travel: 8 minutes
> Available travel window: 10 minutes
> Margin: +2 minutes

Other margins may include:

* Time remaining at current location
* Maximum tolerable delay
* Maximum tolerable waiting period
* Latest departure time
* Downstream schedule margin
* Required departure now

---

## 10.1 Arrival margin is not automatically usable schedule margin

The system must distinguish:

**Travel margin**

from

**usable schedule margin**.

If a driver arrives two minutes before a passenger's appointment, those two minutes may simply become passenger waiting time.

They should not automatically shift all subsequent schedule events two minutes earlier.

The scheduler must model activity windows and waiting constraints.

---

# 11. Multi-stop Sorties

A sortie may have:

**A → B → C → D**

The routing abstraction must support:

* Multiple stops
* Route geometry
* Distance
* Traffic-aware duration
* Alternative routes
* Other routing functionality

The routing provider must be replaceable.

Google Maps is an initial provider but must not be embedded as an irreplaceable core dependency.

---

# 12. Variable Waiting

Some stops have uncontrollable or variable waiting periods.

Example:

A passenger enters a grocery store while the driver waits.

The system may maintain an estimated waiting ceiling.

Example:

> Current wait ceiling: 20 minutes.

The driver may revise it:

> 20 → 30 minutes.

The scheduling engine recalculates immediately.

The system should determine the maximum tolerable wait based on downstream commitments.

Example:

> **You can wait another 12 minutes and still meet your next commitment.**

This functionality is considered core scheduling functionality.

---

# 13. Schedule Conflicts

Conflict detection must occur both:

### Before creation

While a driver is entering a new sortie, the system should immediately determine whether the proposed sortie conflicts with the driver's schedule.

The driver should see the conflict before submitting the sortie.

### After creation

Any change to:

* Time
* Route
* Assignment
* Current location
* Traffic
* Waiting
* Other relevant variables

may trigger recalculation.

---

## 13.1 Human override

The system warns and predicts.

The driver remains the final authority regarding actual adherence.

A hard commitment is a strong scheduling constraint, not an immutable prohibition.

Overrides must be recorded.

---

# 14. Schedule Adherence and Attribution

The system should preserve separate temporal facts where they can be established or inferred.

Examples:

* Scheduled arrival
* Actual arrival
* Scheduled activity time
* Inferred activity completion
* Scheduled departure
* Actual departure
* Completion time

This permits later reconstruction of operational performance.

Example:

> Driver arrived two minutes early.

> Vehicle departed two minutes after scheduled pickup.

The system may infer that the delay occurred after the driver's early arrival.

It should distinguish observable sequence from causal attribution.

Where attribution is inferred rather than explicitly known, it should be represented as an inference rather than an established fact.

---

# 15. Driver Availability and Duty

Availability is a simple Boolean.

`available = true`

means the driver is willing to receive/accept dispatch work.

Availability is not equivalent to duty state.

The driver also has an on-duty/off-duty state.

Company behavior determines whether duty is:

* Driver-controlled
* Schedule-controlled
* Otherwise assigned

Off duty stops GPS transmission entirely.

On duty starts GPS transmission unless vehicle identity is ambiguous.

---

# 16. Current Vehicle

The system explicitly tracks the driver's current operating vehicle.

GPS fundamentally belongs to the driver's device.

Vehicle location may be inferred from the driver's location only when the driver is known to be operating that vehicle.

GPS must not automatically propagate to every vehicle associated with the driver.

If vehicle identity is ambiguous, the system may require driver confirmation.

If company configuration makes vehicle identity unambiguous, unnecessary confirmation should be avoided.

---

# 17. Location Data

GPS is modeled primarily as timestamped observations.

A continuous track should not initially be treated as a fundamental domain object.

Tracks can be reconstructed from observations.

Location history may be associated with sorties so that actual movement during a sortie can be reconstructed.

Location retention follows the effective retention policy.

---

# 18. Location Privacy

Precise driver location is not generally visible to every driver.

Location may be disclosed when required for a specific operational purpose.

The platform determines when such disclosure is appropriate.

A generic company-configurable permission matrix is not required as a foundational mechanism.

Drivers can see relevant operational information about other drivers without necessarily receiving their precise coordinates.

---

# 19. Traffic Reports

Drivers can create lightweight traffic observations.

The driver should be able to access a traffic-report action from the normal driver interface.

The system automatically captures:

* Driver
* Location
* Time
* Direction where determinable
* Geographic context

The driver can select a simple report type such as:

* Heavy traffic
* Stopped traffic
* Accident
* Road closure
* Hazard

An optional short note may be supplied.

Traffic reports are geographically persistent observations and can appear on other drivers' maps.

The reports should remain attributable and timestamped.

They are distinct from routing-provider traffic data.

The platform may eventually combine multiple traffic signals without treating a driver report as equivalent to authoritative routing-provider data.

---

# 20. Facility Operational Protocols

Facilities can impose operational procedures on participating companies.

The facility owns the real-world process.

The platform implements a digital representation of it.

A protocol can contain:

* Operational zones
* Capacity
* Queue state
* Participant state
* Geofences
* Signals
* Explicit driver actions
* Automatic observations
* State transitions

---

## 20.1 Airport queue example

The flagship company's airport operation currently includes:

* One curbside position
* Multiple participating taxi companies
* A remote staging/queue location
* First-come-first-served ordering
* A physical beacon
* A physical switch controlling the beacon

The platform should represent this as a facility protocol rather than as "airport taxi functionality."

The digital implementation may replace:

**Physical beacon → application signal**

and:

**Physical switch → driver application action / system observation**

---

## 20.2 Queue state

Queue participation is explicit operational state.

The system may maintain:

* Queue membership
* Queue position
* Curb occupancy
* Eligibility to proceed

GPS supplies evidence.

If GPS suggests that a driver has left their queue position, the system should warn the driver before consequentially changing their queue participation state.

Reliable protocol violations may instead result in direct protocol-state enforcement.

The system does not escalate violations to external facility/company contacts.

---

# 21. Facility State and Company Consequences

The facility protocol defines what is happening.

The company defines what that means operationally.

For the flagship company:

* Curb occupant → unavailable for dispatch
* Queue position 1 → unavailable
* Queue position 2 → unavailable
* Queue position 3+ → available

These are company rules.

They must not become universal platform definitions of queue behavior or driver availability.

---

# 22. Dispatch

Dispatch is a supported operational function rather than necessarily a separate organizational department.

Any authorized company driver may perform dispatch functions.

The company may designate an official dispatcher through a dispatch shift.

Dispatch shifts are calendar events.

The current dispatcher identity can be broadcast to company drivers so that drivers know whom to communicate with.

A dispatcher may:

* Create sorties
* Offer sorties
* Seek candidate drivers
* Assign work through the acceptance workflow
* Perform other company-authorized dispatch functions

---

## 22.1 Candidate selection

Dispatch candidate selection should not simply sort drivers by latest GPS coordinate.

The system should evaluate driver/vehicle pairs using:

* Current location
* Current activity
* Route to pickup
* Traffic
* Existing sortie
* Schedule feasibility
* Future commitments
* Availability
* Duty state
* Qualifications
* Vehicle capabilities
* Facility constraints

The dispatcher may select:

* One driver
* Multiple drivers
* All available drivers
* Available and unavailable drivers

depending on company-supported workflows.

---

# 23. Automated and AI-Assisted Sortie Creation

The platform should support automated acquisition of work.

Potential channels include:

* Human telephone dispatcher
* Automated telephone agent
* Speech transcription
* AI extraction
* Web booking
* Mobile application
* External API

The AI layer is an **input adapter**, not a core domain dependency.

---

## 23.1 Telephone workflow

A customer telephone call can be:

**Voice → transcription → structured extraction → draft sortie**

The system can extract:

* Customer name
* Telephone number
* Pickup
* Destination
* Date
* Time
* Passenger information
* Service requirements
* Other sortie-specific fields

The dispatcher should primarily conduct the conversation rather than manually type information while driving.

The system can construct the draft in realtime.

The dispatcher reviews the result and confirms it.

---

## 23.2 Cost estimation

Where the business requires a fare/cost estimate, the system should calculate it automatically using the applicable company/platform configuration.

The driver or dispatcher should not need to manually open a mapping application and calculate the distance while simultaneously handling a customer call.

---

# 24. Customer Booking

The platform should eventually support direct customer booking through a web interface.

A customer-submitted booking should follow the same conceptual path as any other source:

**Customer → booking interface → draft/validated sortie → sortie**

The customer interface is another input mechanism.

It does not create a separate "web booking object" that downstream operations must treat differently from a telephone-created or driver-created sortie unless there is a demonstrated domain requirement.

---

# 25. Realtime Communication

The platform requires realtime propagation for operational state.

Examples include:

* Sortie offers
* Acceptance
* Transfers
* Dispatcher identity
* Driver availability
* Facility state
* Queue state
* Traffic reports
* Schedule changes
* Warnings
* Other operational changes

The preferred conceptual model is:

**Command → server → authoritative state → event → subscribed clients**

---

# 26. Communication Associated With Sorties

When drivers exchange information about a sortie, communication may be associated with the sortie relationship.

For example:

Driver A sends a sortie to Driver B.

Driver B can communicate with Driver A regarding that transfer.

The conversation may remain part of operational history after completion, subject to retention policy.

Cross-company communication does not automatically imply broad access to either company's internal data.

---

# 27. Visibility

A driver can see the complete details of their own calendar.

A company viewing a driver associated with multiple companies may see that another company's event occupies a time period without seeing confidential details.

A driver accepting a sortie from another company receives the information necessary to perform that sortie but does not thereby gain access to the originating company's broader operational data.

Precise location remains contextual and purpose-bound.

---

# 28. Roles and Capabilities

The platform maintains a centrally managed vocabulary of roles/capabilities.

Companies can configure which supported capabilities their roles receive.

The platform team adds new role types and capabilities.

Companies do not receive arbitrary role-definition or arbitrary custom-field systems.

The exact future mechanism for expressing complex company-specific operational consequences remains intentionally unresolved.

---

# 29. Retention

Historical operational data is subject to retention policy.

Both platform-level and company-level retention policies may exist.

The effective retention policy determines how long relevant data is retained.

This applies to appropriate categories including:

* GPS observations
* Sortie history
* Operational events
* Communication history
* Other retained operational records

The architecture must support retention without assuming permanent historical storage.

---

# 30. History and Auditability

Significant operational events should be retained as immutable chronological history.

Examples include:

* Sortie creation
* Assignment
* Offer
* Acceptance
* Rejection
* Transfer
* Cancellation request
* Cancellation response
* Commencement
* Completion
* Schedule changes
* Overrides
* Facility-state transitions
* Other consequential actions

Current state and historical events should be architecturally distinct.

The current state answers:

> What is happening now?

The history answers:

> How did we get here?

---

# 31. Routing Abstraction

Routing functionality must be provider-independent.

The abstraction should support at least:

* Distance
* Duration
* Traffic-aware duration
* Route geometry
* Multi-stop routing
* Alternative routes

Google Maps may be the initial implementation.

The domain model must not become dependent upon Google-specific representations.

A routing provider should be replaceable or supplemented.

---

# 32. Configuration Model

Configuration follows a concierge/platform-administered model.

The platform team configures:

* Companies
* Enabled sortie types
* Capabilities
* Qualifications
* Roles
* Facility protocols
* Company-specific consequences
* Retention policies
* Other supported configuration

The initial architecture should not introduce a general-purpose end-user rules engine merely to avoid writing application code.

At the same time, the architecture must not make future extension unnecessarily difficult.

The exact abstraction for company-specific rules remains an open design decision.

---

# 33. Platform Invariants vs Configuration

The implementation must explicitly distinguish:

### Platform invariants

Things that must remain true throughout the system.

Examples:

* A responsible active sortie has one responsible driver.
* Responsibility requires acceptance.
* A driver may belong to multiple companies.
* Sorties have independent identity and lifecycle.
* Historical events are retained according to policy.
* Server state is authoritative.
* GPS observations are distinct from inferred state.

### Configuration

Things that vary by company/facility.

Examples:

* Whether duty is driver-controlled
* Vehicle assignment behavior
* Commitment strength
* Facility participation
* Queue consequences
* Dispatch practices
* Sortie types enabled
* Required qualifications
* Company retention policy

This distinction must be preserved throughout implementation.

---

# 34. Security and Authorization

Authorization must be based on:

* User identity
* Company relationship
* Role/capability
* Relevant operational relationship
* Context
* Facility participation where appropriate

The system must not treat possession of a driver account as authorization to access every company or every sortie.

Cross-company relationships require deliberate authorization.

---

# 35. Mobile Architecture

The initial mobile client is:

**Expo + React Native + TypeScript**

The mobile application should be designed as an operational client rather than as the authoritative domain.

The client:

* Displays state
* Sends commands
* Captures observations
* Captures explicit human actions
* Performs appropriate local UX behavior
* Receives realtime updates

The server remains authoritative.

---

# 36. Driver UX Principles

The driver application should optimize for operation while driving.

Principles:

1. Minimize manual input.
2. Prefer large, obvious actions.
3. Avoid unnecessary forms.
4. Surface relevant operational state contextually.
5. Use GPS and system inference whenever reasonable.
6. Provide navigation as part of sortie execution.
7. Make warnings actionable.
8. Avoid requiring the driver to understand internal system concepts.
9. Do not expose unnecessary calculations.
10. Preserve human control where the system cannot reliably know intent.

---

# 37. Architectural Anti-Patterns

The implementation should avoid:

### Taxi-specific core abstractions

Do not create universal concepts such as:

* `TaxiPassenger`
* `AirportTaxi`
* `TaxiQueue`

unless they are clearly configuration or specialized implementations.

### Arbitrary tenant schemas

Do not give every company an uncontrolled custom-field mechanism as a substitute for domain modeling.

### UI-only scheduling logic

Schedule feasibility belongs to a domain/service layer, not solely inside the mobile interface.

### GPS as truth about human intent

GPS is evidence.

It does not automatically prove:

* Passenger entered
* Driver accepted responsibility
* Customer cancelled
* Driver intentionally abandoned a queue
* Other human-intent events

### AI as the domain model

AI extracts information.

AI does not define what a sortie is.

### Client-authoritative state

A mobile client must not independently establish authoritative assignment, responsibility, completion, or facility state without server validation.

---

# 38. Architectural Decisions

Resolved decisions are recorded in `docs/04-technical-architecture.md`. The remaining items in this section are intentionally unresolved.

## Backend technology

Resolved. TypeScript on Node LTS, in the monorepo described in `docs/04-technical-architecture.md`.

## Database implementation

Resolved. PostgreSQL is the system of record. Current state is relational. History is an append-only event table committed with the state change. See `docs/04-technical-architecture.md`.

## Event architecture

The distinction between current state and immutable history is established.

Resolved. Durable history is the append-only PostgreSQL event table. Live fanout is NATS core pub/sub to the WebSocket gateway. NATS is not the event store. See `docs/04-technical-architecture.md`.

## Authentication

Resolved. The platform owns User identity. The server issues opaque session tokens stored hashed in PostgreSQL. The credential channel is chosen by the first slice that includes sign-in. See `docs/04-technical-architecture.md`.

## Realtime transport

Resolved. Clients receive live updates through the server's WebSocket gateway, which broadcasts events from NATS. See `docs/04-technical-architecture.md`.

## Telephony provider

Not yet selected.

## Speech transcription provider

Not yet selected.

## AI extraction provider/model

Not yet selected.

## Fare/cost calculation

The system must support automatic estimation, but the exact pricing model and implementation remain to be defined.

## Company-specific rules

The system needs extensible company-specific consequences.

Whether these are represented by:

* fixed platform-supported configuration,
* a constrained policy system,
* or a more generalized rules mechanism

remains unresolved.

Do not invent a general-purpose rules engine merely to resolve this uncertainty.

## Facility protocol authoring

Protocols are concierge-configured.

The precise internal authoring/configuration model remains open.

---

# 39. Implementation Guidance for Cursor

Cursor should treat this document as a specification of **domain intent**, not merely a list of UI features.

When implementing functionality:

1. Identify whether a requirement is a platform invariant or configuration.
2. Do not promote flagship-company behavior into universal domain semantics without justification.
3. Preserve existing domain terminology.
4. Prefer explicit domain objects over overloaded generic records.
5. Keep current state separate from historical events.
6. Preserve provenance.
7. Treat observations, assertions, inferences, and authoritative state distinctly.
8. Keep driver interaction minimal.
9. Keep scheduling logic out of presentation components.
10. Keep routing providers behind an abstraction.
11. Make cross-company behavior deliberate.
12. Preserve multi-tenant boundaries.
13. Do not silently invent missing business rules.
14. When an architectural decision is genuinely unresolved, record it rather than making an arbitrary permanent commitment.
15. Prefer the smallest abstraction that satisfies demonstrated requirements.
16. Avoid premature generalization.
17. Do not make the flagship company's current workflow the definition of the platform.

---

# 40. Reference Mental Model

The platform can be understood as several interacting layers:

**Human identities**

↓

**Companies / operational relationships**

↓

**Drivers / vehicles / fleets**

↓

**Sorties / schedules / responsibilities**

↓

**Routing / location / observations**

↓

**Facility protocols / external operational constraints**

↓

**Company-specific configuration**

↓

**Realtime operational state**

↓

**Human-facing interfaces**

The system continuously observes the physical world, compares those observations with commitments and protocols, calculates consequences, communicates them to humans, and records what actually happens.

The fundamental philosophy is:

> **The system observes and calculates; humans remain responsible for real-world action.**

At the same time, the system should eliminate unnecessary human data entry by deriving as much operational information as can reasonably be established from existing observations.

---

# 41. Initial Success Criteria

The first implementation should ultimately demonstrate that a driver can:

1. Become operationally available.
2. Receive a sortie.
3. Accept responsibility.
4. Commence it with one explicit action.
5. Immediately obtain navigation.
6. Drive the route without repeatedly entering data.
7. Have meaningful operational events reconstructed from GPS.
8. Receive schedule-margin information.
9. Receive warnings when commitments become threatened.
10. Complete the sortie with one explicit action.

The company should be able to:

1. Create or receive sorties through multiple channels.
2. Assign future work.
3. Evaluate driver/vehicle eligibility.
4. Evaluate schedule feasibility.
5. Dispatch work.
6. Observe operational state.
7. Configure company-specific consequences of supported platform states.
8. Participate in facility protocols.
9. Review historical operational events.

The platform should ultimately demonstrate that a single sortie can originate from:

**Driver → dispatcher → telephone AI → automated telephone → customer web booking → external integration**

without requiring a fundamentally different downstream operational model.

---

# 42. Next Specification Phase

This document establishes the conceptual foundation.

The next documents should be derived from it rather than independently invented.

Recommended decomposition:

1. **Domain Model & Invariants**
2. **Sortie Lifecycle & Assignment**
3. **Scheduling, Routing & Feasibility Engine**
4. **Driver Experience & Mobile Workflows**
5. **Facility Protocols**
6. **Sortie Ingestion, Telephony & AI**
7. **Realtime, Location & Privacy**
8. **Technical Architecture & Development Rules**

These should preserve the decisions in this specification while expanding each area into implementation-level guidance.
