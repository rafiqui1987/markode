---
type: architecture
status: pending
updated: {{date}}
---

# Architecture

## Overview

<!-- Two or three sentences: what the system does and its main parts. -->

## Structure

```tree
src/
  api/        # HTTP handlers, one file per resource
  core/       # business logic, no I/O
  db/         # schema, migrations and queries
tests/        # mirrors src/
```

## Components

| id | component | responsibility | talks to |
|---|---|---|---|
| C1 | API | validates requests and calls core | Core |
| C2 | Core | business rules | DB |
| C3 | DB | persistence | |

## Data flow

```mermaid
flowchart LR
  User --> API --> Core --> DB[(Database)]
  Core --> Queue[[Queue]] --> Worker
```

## Key sequence

```mermaid
sequenceDiagram
  participant U as User
  participant A as API
  participant C as Core
  U->>A: POST /orders
  A->>C: createOrder()
  C-->>A: order
  A-->>U: 201 Created
```

## External services

| id | service | used for | config |
|---|---|---|---|
| E1 | | | |
