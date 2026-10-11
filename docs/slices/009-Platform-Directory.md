# Slice 009 — Platform Directory

## Status

**Previous slice:** 008 — Account Live Updates

**Derived from:** the User, Company, and Facility concepts in `docs/03-domain-model.md`, and Technical Architecture (`docs/04-technical-architecture.md`) sections 5 and 6.

**Purpose:** A platform administrator can list, create, edit, and delete companies, facilities, and users.

This document is the implementation boundary. Protocols, facility participation, invites, passwords, and a persisted role stay outside.

---

# 1. User capability

After this slice, a platform administrator using the local client can:

1. See every company, facility, and user.
2. Create, rename, and delete a company.
3. Create, rename, and delete a facility.
4. Create a user, change that user's display name and email, and delete a user.

A signed-in person who is not a platform administrator does not see the directory and cannot call these operations. The directory does not show sorties, locations, tariffs, or other operational records.

---

# 2. Actors

One actor: a platform administrator. That is a signed-in user whose email is listed in `PLATFORM_ADMINISTRATOR_EMAILS`. Comparison ignores case and surrounding spaces. An empty or missing variable means nobody is an administrator. A user with no email is never one.

There is no role table and no screen that grants the role.

---

# 3. Domain objects

## 3.1 Company

A company already stored by the platform. This slice reads and writes its id, name, and created time. It does not change drivers, sorties, or company configuration.

## 3.2 Facility

A facility is the external organization from `docs/03-domain-model.md`. This slice stores its id, name, and created time. It does not store a protocol, a geofence, or a company link. Names need not be unique.

## 3.3 User

A user is the existing platform identity. The directory shows id, display name, email, and created time.

A user created here has no Google credential and cannot sign in. Sign-in still finds a user by Google `sub`, not by email. The next Google sign-in for a linked user still overwrites that user's display name and email from the token.

`GET /me` and session creation include `platformAdministrator` on the user so the client knows whether to show the directory.

---

# 4. State transitions

Creating, renaming, and deleting these rows changes the directory only. These writes are not operational-history events and are not published on the bus.

Delete rules:

- A facility delete always removes that row.
- A company delete is refused while a driver relationship or a sortie still references it.
- A user delete is refused for the signed-in administrator, and while that user's driver still has a sortie, a location observation, a meter reading, or a tariff.
- A user delete that succeeds removes that user's sessions, Google credential, driver-company links, and driver row, then the user. The company stays.

---

# 5. Interfaces

When the signed-in user is a platform administrator, the client shows a Directory destination beside Navigation, Calendar, and Settings. Other users do not see it.

The screen lists companies, facilities, and users, with an empty state for each. Each list can add a row, edit that row's directory fields, and delete a row. Delete asks for confirmation. A refusal because the record is still in use is shown on the screen. After a successful write, that list reloads. A rejected session follows the existing sign-out path.

A company or facility is a name. A user is a display name and an optional email.

---

# 6. Backend

Commands are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| List companies | `GET /companies` | Every company |
| Create company | `POST /companies` with `{ name }` | The company |
| Rename company | `PATCH /companies/:id` with `{ name }` | The company |
| Delete company | `DELETE /companies/:id` | Removed, or refused when still in use |
| List facilities | `GET /facilities` | Every facility |
| Create facility | `POST /facilities` with `{ name }` | The facility |
| Rename facility | `PATCH /facilities/:id` with `{ name }` | The facility |
| Delete facility | `DELETE /facilities/:id` | Removed |
| List users | `GET /users` | Every user |
| Create user | `POST /users` with `{ displayName, email }` | The user |
| Edit user | `PATCH /users/:id` with `{ displayName, email }` | The user |
| Delete user | `DELETE /users/:id` | Removed, or refused when still in use or when the id is the caller |

A missing or revoked session is 401. A signed-in non-administrator is 403 and no row is written. An invalid body is 400. An unknown id is 404. An in-use or self delete is 409.

A company or facility name must be non-blank after trimming. A user needs a non-blank display name. An empty email is stored as null. Lists are ordered by name. Users are ordered by display name, then email.

---

# 7. Persistence

Drizzle owns the schema and the migration. This slice adds **facility**: id, name, created time.

Company and user tables stay as they are. Primary keys are server-generated UUIDs. Timestamps are `timestamptz` in UTC.

---

# 8. Realtime

The directory does not publish or subscribe. A client sees another administrator's write on its next read.

---

# 9. Acceptance criteria

The slice works when all of the following are true:

1. An allowlisted email can list, create, edit, and delete a company, a facility, and a user.
2. Another signed-in user receives 403, and those calls change nothing.
3. A missing token receives 401.
4. A blank name is rejected.
5. Deleting a company that still has a driver link or a sortie is refused, and the company remains.
6. Deleting a user who still has a sortie is refused.
7. Deleting a user who has only a session and a credential removes those rows.
8. A person who is not a platform administrator does not see Directory.
9. The flow runs with `pnpm dev:server` and `pnpm dev:mobile`.

---

# 10. Remains unimplemented

- Operational protocols and facility participation
- Sortie, location, and tariff data in these lists
- A persisted platform role, an invite, and a password
- Merging a platform-created user with a later Google sign-in
- Live updates of the directory
- Cascading deletion of sorties or other operational records
