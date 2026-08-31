---
name: OpenAPI integer validation
description: Orval-generated Zod schemas may not enforce integer semantics for OpenAPI integer fields.
---

Treat generated validation for OpenAPI integer fields as potentially accepting fractional JavaScript numbers; verify generated runtime behavior and enforce integer semantics at sensitive mutation boundaries.

**Why:** A generated runtime validator accepted fractional values for an integer contract, allowing malformed indexes past schema validation.

**How to apply:** For ordering, indexing, count, and identifier-like numeric inputs, test a fractional value and add an explicit server integer check when generation does not preserve the contract.