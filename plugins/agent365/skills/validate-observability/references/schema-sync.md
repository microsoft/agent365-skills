# Syncing `maven-schema.json` from upstream

`maven-schema.json` is the canonical contract for A365 observability data shape.
It is generated from `[MavenAttributes]` annotations in the upstream
`mvn-mavenservice` repo by the `MavenSchemaGenerator` Roslyn source generator
(see `D:\mvn-mavenservice\src\MVN\MavenService.Analyzers\MavenSchemaGenerator.cs`).

## When to sync

- After upstream rebases that touch `[MavenAttributes]`-annotated constants in
  `Microsoft.Maven.Otel.Contracts.Models.SpanAttributeKeys` or a sibling.
- Before a release of this plugin.

## How to sync

1. From a fresh clone of `mvn-mavenservice` on its main branch, copy:

       cp <mvn-mavenservice>/docs/maven-schema.json \
          plugins/agent365/skills/validate-observability/references/maven-schema.json

2. Run the validator tests:

       npm test -- tests/vo-schema-driven.test.js

   If any test fails, the upstream schema added or renamed a field. Update
   the validator's table-driven cases or fixtures, never the schema itself.

3. Commit with a message that names the upstream commit hash you synced from:

       git commit -m "Sync maven-schema.json from mvn-mavenservice@<sha>"

## Schema shape (cheat sheet for validators)

Each entry in `fields[]`:

- `key`              — attribute name (e.g. `gen_ai.operation.name`)
- `type`             — `String | Int | StringArray | Bytes | UInt64 | Object`
- `description`      — human-readable
- `examples`         — array of strings
- `privacy`          — `EUII | EUPI | OII | CustomerContent` (absent = None)
- `structural`       — true for OTLP structural fields (`traceId`, `spanId`, etc.)
- `required`         — `Predicate[][]`: outer = OR, inner = AND
                       Each predicate: `{ field, condition: "in" | "not_in",
                                          values: [...], legacy_names?: [...] }`

Empty `required` (`[[]]` or absent) means "always required" / "never required"
respectively — see `schema-driven.js` predicate evaluator for exact semantics.
