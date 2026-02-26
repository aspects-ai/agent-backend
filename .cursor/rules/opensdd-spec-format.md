---
description: "OpenSDD spec format reference. Defines the structure and rules for behavioral specifications. Referenced by sdd-manager and sdd-generate skills."
alwaysApply: false
---

# Spec Format

> Defines the standard format for behavioral specifications in the OpenSDD (Open Spec-Driven Development) protocol.

## Version

0.1.0

## Overview

A "spec" is a behavioral contract for a piece of software. Unlike source code, a spec defines **what** software does and **what constraints** it must satisfy, while leaving **how** it is implemented to the consuming agent.

A spec MAY optionally declare a target language, runtime, or framework (e.g., "This is a Node.js CLI tool") when the spec is inherently tied to a specific platform. When a spec declares a target platform, the implementing agent MUST use that platform. When a spec does not declare a target platform, the agent reads the spec alongside the consumer's project context (language, framework, conventions) and generates a bespoke implementation.

Specs exist in two contexts:

- **Authored spec** (`opensdd/spec.md`) — the spec that a project defines as its source of truth. Development is spec-first: the spec is edited, then code is updated to match. It can be published to a registry for others to consume.
- **Installed dependency specs** (`.opensdd.deps/`) — specs pulled from a registry and installed into a consumer project. The `.opensdd.deps/` directory is committed to the repo so that installed specs are always available without requiring a registry fetch.

A project MAY be both an author (has `opensdd/spec.md`) and a consumer (has `.opensdd.deps/` with installed dependencies). These are independent concerns tracked in a single `opensdd.json` manifest.

In a monorepo, each sub-project that needs its own spec maintains its own `opensdd.json`, `opensdd/`, and `.opensdd.deps/` at its sub-project root — the same way each package in an npm workspace has its own `package.json`. The CLI always operates relative to the nearest `opensdd.json` in the directory hierarchy.

The OpenSDD protocol installs two skills into the project: **sdd-manager** teaches agents how to implement, update, and verify installed dependency specs; **sdd-generate** teaches agents how to generate specs from existing code. Individual specs are not skills — they are data that the skills operate on.

Skills are installed into the native configuration format of each supported coding agent so they are automatically discovered. The canonical skill content follows the Agent Skills standard (agentskills.io) with `SKILL.md` files; adapter files are generated for agents with different configuration systems. See the CLI spec for the full installation mapping. Supported agents:

- **Claude Code** — `.claude/skills/<name>/SKILL.md` (Agent Skills standard, native)
- **OpenAI Codex CLI** — `.agents/skills/<name>/SKILL.md` (Agent Skills standard, native)
- **Cursor** — `.cursor/rules/<name>.md` (rules with YAML frontmatter)
- **GitHub Copilot** — `.github/instructions/<name>.instructions.md` (instructions with YAML frontmatter)
- **Gemini CLI** — `GEMINI.md` updated with `@` imports referencing the canonical skill files
- **Amp** — `AGENTS.md` updated with `@` references to the canonical skill files

## Requirement Level Keywords

This spec and all specs written in the OpenSDD format use requirement level keywords as defined in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are to be interpreted as described in RFC 2119.

Spec authors MUST use these keywords in behavioral contracts and invariants to distinguish between hard requirements, recommendations, and optional behaviors.

## Behavioral Contract

### Spec Structure

A spec is a directory containing spec files. The directory name is the bare spec name — lowercase alphanumeric and hyphens only.

#### Required files

In the registry and in installed dependency specs (`.opensdd.deps/`), every spec directory MUST contain:

- `manifest.json` — Metadata about the spec (name, version, spec_format, description, dependencies).
- `spec.md` — The behavioral contract and acceptance criteria. The spec IS the acceptance criteria — a well-written spec contains everything needed to both implement and verify the software.

For the authored spec (`opensdd/`), the directory contains `spec.md` and any supplementary files. The metadata that would be in `manifest.json` lives in the `opensdd.json` `publish` entry instead; a separate `manifest.json` file is constructed during publishing.

The spec author MAY include additional files in the spec directory (e.g., supplementary schema definitions, sub-specs for components, reference schemas). The protocol does not mandate any particular directory structure beyond the required files — organization of supplementary files is at the author's discretion.

`spec.md` SHOULD use relative markdown hyperlinks to reference any supplementary files. `spec.md` is the starting point for reading the spec; all other files in the spec directory MUST be reachable by following links from `spec.md` (directly or transitively). This makes the spec self-navigating — an agent reading `spec.md` can discover and follow links to component specs, schema definitions, or other supporting documents as needed.

#### Consumer additions (installed dependency specs only)

- `deviations.md` — Consumer-owned. Documents intentional divergences from the spec. MUST NOT be created by the registry or install process; only created by the consumer (or their agent) when they choose to deviate.

#### File ownership (installed dependency specs)

All files installed from the registry (`manifest.json`, `spec.md`, and any supplementary files) are **spec-owned** — they are overwritten on update and the consumer MUST NOT edit them. `deviations.md` is **consumer-owned** — it MUST NOT be created, modified, or deleted by the CLI or any automated tooling. Only the consumer or their agent (acting on explicit user instruction) may create or edit `deviations.md`.

Files in `opensdd/` are fully owned by the author — there is no ownership distinction.

### spec.md Format

The spec is both the behavioral contract and the acceptance criteria. A well-written spec MUST contain everything an agent needs to implement the software AND verify that the implementation is correct. The spec's inline examples, edge cases, and invariants ARE the acceptance criteria.

The primary audience for a spec is an AI agent implementing the described software. The format prioritizes content completeness over structural rigidity — agents can parse natural language documents regardless of heading structure.

#### Required Structure

A spec MUST contain:

1. **Header** — the spec name as an H1, followed by a one-line blockquote summary.

   ```markdown
   # {name}

   > {one-line description of what this software does}
   ```

2. **Behavioral Contract** — an H2 section (`## Behavioral Contract`) containing one or more H3 subsections describing the software's behavior. Each subsection covers a logical grouping of functionality. For each behavior, the spec MUST define what inputs are accepted, what outputs are produced, what side effects occur (if any), and how errors are handled. Behaviors MUST describe **what** happens, not **how**. Implementation details (data structures, algorithms, internal architecture) MUST NOT appear in this section.

Beyond these two requirements, the spec author is free to organize supplementary content however best serves clarity. The sections below are RECOMMENDED patterns that have proven valuable, but they are not structurally required.

#### Inline Examples

Each behavioral subsection MAY include inline examples demonstrating the expected behavior with concrete inputs and outputs. Inline examples are most valuable for behaviors that benefit from concrete demonstration — simple or self-explanatory behaviors do not require them. When present, inline examples serve as both documentation and behavioral anchors — they ground the spec in concrete inputs and outputs that make the intended behavior unambiguous.

For pure/stateless behavior, use direct input/output examples:

```markdown
### Core Behavior

Accepts a string input and returns a URL-friendly slug.

- `slugify("Hello World")` MUST return `"hello-world"`
- `slugify("Déjà Vu")` MUST return `"deja-vu"`
- `slugify("  --foo-  ")` MUST return `"foo"`
```

For stateful, async, or side-effect-heavy behavior, use narrative scenarios with RFC 2119 keywords:

```markdown
### Retry Behavior

When a request fails with a transient error (5xx status or network timeout),
the client MUST retry up to the configured maximum attempts.

Given an endpoint that fails twice then succeeds:
- After the first failure, the client MUST wait approximately `baseDelay` before retrying
- After the second failure, the client MUST wait approximately `baseDelay * 2` before retrying
- The third attempt MUST succeed and return the response

Given an endpoint that always returns 503:
- The client MUST attempt exactly `maxRetries + 1` total requests
- After exhausting retries, the client MUST throw `Error(RetriesExhausted)`
```

Spec authors MAY include diagrams (mermaid, ASCII) to illustrate state machines, data flows, or complex interactions where a visual representation aids comprehension.

#### Recommended Sections

The following sections are RECOMMENDED for well-rounded specs. They can appear in any order and may be organized however the author prefers — as dedicated H2 sections, inline within the Behavioral Contract, or in supplementary files linked from `spec.md`.

**Edge Cases** — Explicitly enumerate edge cases and the expected behavior for each. When included, edge cases SHOULD have concrete examples. Behaviors that might be "obvious" to a human reader SHOULD be stated explicitly for reliable agent implementation. Edge cases may alternatively be woven into the relevant Behavioral Contract subsections rather than separated out.

```markdown
## Edge Cases

- Empty string: `slugify("")` MUST return `""`
- Whitespace only: `slugify("   ")` MUST return `""`
- Already valid: `slugify("hello-world")` MUST return `"hello-world"`
- Consecutive separators: `slugify("foo---bar")` MUST return `"foo-bar"`
```

**NOT Specified (Implementation Freedom)** — Explicitly list aspects left to the implementer's discretion. This helps prevent agents from over-constraining their implementation to match perceived spec intent. Particularly valuable for specs where the boundary between contract and freedom is non-obvious.

**Invariants** — Properties that MUST hold true across all inputs and states. These are universal assertions that translate directly into tests. Invariants SHOULD be expressed as testable assertions:

```markdown
## Invariants

- For any string `x`: `slugify(slugify(x)) === slugify(x)` (idempotent)
- For any string `x`: the output MUST match pattern `^[a-z0-9]+(-[a-z0-9]+)*$` or be empty
```

**Options / Configuration** — Configurable parameters with name, type, default value, and description of effect. Options SHOULD include inline examples.

**Implementation Hints** — Guidance that helps agents make better choices — performance, data size, common pitfalls, concurrency considerations. When the spec does not declare a target platform, implementation hints SHOULD be language-agnostic. When the spec targets a specific platform, hints MAY reference platform-specific tools, libraries, or idioms. Implementation hints MUST NOT contain behavioral requirements; any requirement that affects correctness belongs in the Behavioral Contract.

**Version** — The spec's semantic version number. When installed as a dependency, the canonical version lives in `opensdd.json`; this section provides a human-readable reference.

**Overview** — Brief description of the spec's purpose and context. MUST NOT contain behavioral requirements.

### deviations.md Format

Consumer-owned file documenting intentional divergences from an installed dependency spec. Only created when a consumer actually deviates. Not relevant for authored specs in `opensdd/` — the author simply edits the spec directly.

Each deviation is an H2 section:

```markdown
## {short-name} ({deviation-type})

**Spec section:** {which section of spec.md this deviates from, or `*` for entire spec}
**Type:** {feature-omitted | behavior-modified | behavior-narrowed | feature-added}
**Reason:** {why the consumer chose to deviate}
**Test impact:** {which spec sections or inline examples to skip during verification}
```

Deviation types:
- `feature-omitted` — A spec capability is intentionally not implemented.
- `behavior-modified` — A behavior is implemented differently (with explanation).
- `behavior-narrowed` — A behavior is implemented with reduced scope.
- `feature-added` — Consumer added behavior beyond the spec (documented for clarity).

### Spec Dependencies

A spec MAY depend on other specs for shared types, interfaces, or behavioral contracts. Dependencies are declared in the spec's `dependencies` array (in its registry `manifest.json` or in the `publish` entry in `opensdd.json`) and referenced within `spec.md` via markdown links.

The implementing agent MUST read all dependency specs before implementation to understand shared types and contracts. When implementing a spec with dependencies, the agent MUST ensure its implementation is compatible with the dependency's interface.

### OpenSDD-Compliant Repos

An OpenSDD-compliant repo uses specs as the source of truth for desired behavior. Code flows from the spec, not the other way around.

```
my-project/
  opensdd.json          # Manifest: publish config + dependencies
  opensdd/              # This project's authored spec
    spec.md
  .opensdd.deps/        # Installed dependency specs
    slugify/
      spec.md
  src/
    ...
```

In a monorepo, each sub-project maintains its own OpenSDD layer:

```
my-monorepo/
  packages/
    auth/
      opensdd.json
      opensdd/
        spec.md
      .opensdd.deps/
      src/
    payments/
      opensdd.json
      opensdd/
        spec.md
      .opensdd.deps/
      src/
```

The CLI resolves `opensdd.json` by searching upward from the current working directory, similar to how npm resolves `package.json`. Each sub-project is independent — it has its own authored spec, its own dependencies, and its own publish configuration.

#### Spec-first development

The development methodology for an OpenSDD-compliant repo:

1. **Edit the spec** — all behavior changes start in `opensdd/spec.md`. The spec is the source of truth.
2. **Update the code** — the developer or their AI agent updates the implementation to match the spec. The protocol is deliberately not prescriptive about this step — the agent reads the spec, understands what changed, and updates the code accordingly.
3. **Publish** — when the spec and implementation are in sync, the developer publishes the spec version to the registry via `opensdd publish`.

The protocol does not mandate a specific tooling flow for step 2 (e.g., changesets, diffs). The spec is always readable in full, and any capable agent can compare the spec against the implementation to identify gaps.

#### Publishing

A project publishes its spec by declaring it in `opensdd.json` under `publish` and running `opensdd publish`. The CLI reads the spec files from `opensdd/`, constructs the registry entry, and pushes it to the registry. See the CLI spec for full publishing behavior.

### Consumer Repos

Any repo that installs specs from the registry is a consumer. The consumer workflow:

1. `opensdd install <name>` — fetches the spec from the registry and places it in `.opensdd.deps/<name>/`.
2. Agent implements the spec using the sdd-manager skill.
3. `opensdd update [name]` — pulls newer versions, stages changesets in `.opensdd.deps/.updates/` for the agent to process.

The `.opensdd.deps/` directory MUST be committed to the repo. This ensures that installed specs are always present and verified — `opensdd.json` serves as the source of truth for which specs and versions are installed, and the committed deps directory confirms those specs were actually fetched and installed.

### opensdd.json Manifest

The `opensdd.json` file is the project-level manifest. It lives at the project root and is created by `opensdd init`. It serves both authors (via `publish`) and consumers (via `dependencies`).

```json
{
  "opensdd": "0.1.0",
  "registry": "https://github.com/deepagents-ai/opensdd",
  "specs_dir": "opensdd",
  "deps_dir": ".opensdd.deps",
  "publish": {
    "name": "auth",
    "version": "1.0.0",
    "description": "Authentication with multiple provider support",
    "spec_format": "0.1.0",
    "dependencies": []
  },
  "dependencies": {
    "slugify": {
      "version": "2.1.0",
      "source": "https://github.com/deepagents-ai/opensdd",
      "spec_format": "0.1.0",
      "implementation": null,
      "tests": null,
      "has_deviations": false
    }
  }
}
```

#### Top-level fields

- `opensdd` (required): Protocol version string. Agents and the CLI MUST use this to determine how to interpret the manifest.
- `registry` (optional): URL of the default registry. Overridden by the CLI's `--registry` flag. Default: `"https://github.com/deepagents-ai/opensdd"`.
- `specs_dir` (optional): Relative path from the project root to the directory containing the authored spec. Default: `"opensdd"`.
- `deps_dir` (optional): Relative path from the project root to the directory containing installed dependency specs. Default: `".opensdd.deps"`.
- `publish` (optional): Object defining the spec this project publishes. Omit if the project only consumes specs.
- `dependencies` (optional): Object keyed by spec name. Each entry tracks an installed dependency spec. Omit if the project only publishes specs.

#### Publish fields

- `name` (required): Bare spec name — lowercase alphanumeric and hyphens only.
- `version` (required): Semver version of the spec being developed.
- `description` (required): One-line description for registry display.
- `spec_format` (required): Which version of the OpenSDD protocol this spec targets.
- `dependencies` (optional): Array of bare spec names that this spec references for shared types or behavioral contracts.

#### Dependency entry fields

- `version` (required): Semver version of the installed spec.
- `source` (required): URL of the registry this spec was installed from.
- `spec_format` (required): OpenSDD protocol version of the installed spec.
- `implementation` (consumer-managed): Path to the generated implementation file, `null` until implemented.
- `tests` (consumer-managed): Path to the generated test file, `null` until implemented.
- `has_deviations` (consumer-managed): Boolean, `false` until a deviation is created.

Consumer-managed fields MUST be present with explicit `null` or `false` values rather than omitted. Fields MUST survive all update operations.

### Registry

A registry is a versioned store of published specs. The default registry is the `registry/` directory in the OpenSDD GitHub repository (`https://github.com/deepagents-ai/opensdd`).

#### Structure

```
registry/
  slugify/
    index.json                  # Spec metadata and version list
    2.1.0/
      manifest.json             # Version-specific metadata
      spec.md
    2.2.0/
      manifest.json
      spec.md
  http-retry/
    index.json
    1.0.0/
      manifest.json
      spec.md
```

#### index.json

Each spec in the registry MUST have an `index.json` at its root:

```json
{
  "name": "slugify",
  "description": "String to URL-friendly slug",
  "latest": "2.2.0",
  "versions": {
    "2.1.0": { "spec_format": "0.1.0" },
    "2.2.0": { "spec_format": "0.1.0" }
  }
}
```

- `name` (required): Bare spec name.
- `description` (required): One-line description.
- `latest` (required): The most recent published version.
- `versions` (required): Object keyed by semver version string. Each entry MAY include summary metadata (e.g., `spec_format`).

#### manifest.json (per version)

Each version directory MUST contain a `manifest.json`:

```json
{
  "name": "slugify",
  "version": "2.2.0",
  "spec_format": "0.1.0",
  "description": "String to URL-friendly slug",
  "dependencies": []
}
```

- `name` (required): Bare spec name.
- `version` (required): Semver version of this entry.
- `spec_format` (required): OpenSDD protocol version.
- `description` (required): One-line description.
- `dependencies` (optional): Array of bare spec names.

#### Conventions

- The registry MUST NOT contain `deviations.md` files.
- The registry is the source of truth for spec-owned files.
- Spec names MUST be lowercase alphanumeric and hyphens only.
- Version directories MUST be valid semver strings.

### Update Staging

When a dependency spec is updated via `opensdd update`, the CLI stages the update rather than immediately modifying `opensdd.json`. This creates a two-phase workflow: the spec files are updated first, the agent processes the changes, and only after the user confirms the migration is complete does `opensdd update apply` finalize the `opensdd.json` entry.

Staged updates live in `.opensdd.deps/.updates/`, with one directory per spec:

```
.opensdd.deps/
  .updates/
    slugify/
      changeset.md      # Unified diffs and change summary
      manifest.json     # Metadata to apply to opensdd.json
    payments/
      changeset.md
      manifest.json
```

#### changeset.md

Captures everything the agent needs to understand and process the update without re-reading the entire spec from scratch.

```markdown
# Changeset: {name}

**Previous version:** {old semver}
**New version:** {new semver}
**Spec-format:** {old version} → {new version} (or "unchanged")
**Date:** {ISO 8601 date}

## Changed Files

### spec.md

\`\`\`diff
{unified diff of spec.md}
\`\`\`

### {other-file}

\`\`\`diff
{unified diff, if changed}
\`\`\`
```

The changeset MUST include unified diffs for every changed spec-owned file. Staleness detection for deviations is delegated to the agent (via the sdd-manager skill) rather than the CLI, since the agent can perform semantic analysis of whether a deviation is affected by the changes.

#### manifest.json (staged update)

Contains the metadata needed to finalize the `opensdd.json` dependency entry when `opensdd update apply` is called:

```json
{
  "name": "slugify",
  "previous_version": "2.1.0",
  "version": "2.2.0",
  "source": "https://github.com/deepagents-ai/opensdd",
  "spec_format": "0.1.0"
}
```

This is a transient artifact. `opensdd update apply` reads this file, applies the metadata to `opensdd.json`, and deletes the staging directory.

### SDD-Manager Skill

The sdd-manager skill teaches agents how to implement, update, and verify installed dependency specs. It is installed once per project via `opensdd init` alongside the sdd-generate skill, into each supported agent's configuration directory. See [sdd-manager.md](sdd-manager.md) for the full skill workflow, including implementation defaults, the project conventions check, and the verification protocol.

### SDD-Generate Skill

The sdd-generate skill teaches agents how to generate a spec from existing code. See [sdd-generate.md](sdd-generate.md) for the full skill workflow.

### Versioning

Specs use semantic versioning:
- **Major**: Breaking change to the behavioral contract
- **Minor**: Additive change (new optional behavior, new options with backwards-compatible defaults)
- **Patch**: Clarification, additional inline examples, documentation improvement

## Edge Cases

- Only the H1 header, blockquote summary, and `## Behavioral Contract` are required. All other sections (Edge Cases, NOT Specified, Invariants, Options / Configuration, Implementation Hints) are recommended but optional.
- A spec dependency that is not installed: the implementing agent MUST warn the user but MAY proceed if the dependent types can be inferred from context.
- `deviations.md` referencing a spec section removed in an update: the agent SHOULD flag the deviation as potentially stale during the Update workflow.
- Extra fields in a dependency's `opensdd.json` entry beyond those defined by this format: extra fields MUST be preserved during updates and MUST NOT cause errors.
- Circular spec dependencies (A depends on B, B depends on A): not currently supported. The implementing agent MUST detect and report the cycle rather than recursing infinitely.
- `opensdd.json` dependency entry exists but spec directory is missing in `.opensdd.deps/`: the CLI MUST warn and offer to re-install from registry.
- Spec directory exists in `.opensdd.deps/` but no `opensdd.json` dependency entry: the CLI MUST warn. The spec is not tracked.
- Publishing a spec with the same version that already exists in the registry: the CLI MUST reject the publish and suggest bumping the version.
- A project with `opensdd/` but no `publish` in `opensdd.json`: valid — the spec is local-only and not published.

## NOT Specified (Implementation Freedom)

- The internal implementation of the sdd-manager skill (exact prompt wording, instruction structure)
- How agents discover the sdd-manager skill (defined by the Agent Skills standard)
- The transport mechanism for fetching specs from a registry (defined by the CLI spec)
- How agents generate implementations (model choice, prompting strategy, temperature)
- The specific testing framework or test runner (determined by the consumer's project)
- How spec dependencies are resolved when circular (not currently supported)
- The sdd-generate skill's internal workflow (separate concern)
- File encoding (assumed UTF-8)
- How the author syncs implementation with spec changes (the protocol is deliberately not prescriptive about this)
- The exact mechanism for authenticating with the registry during publish (deferred to local git/gh credentials)

## Invariants

- A registry or installed spec directory MUST always contain `manifest.json` and `spec.md`
- Spec-owned files in `.opensdd.deps/` MUST NOT be modified by the consumer or their agent
- `deviations.md` MUST NOT be created, modified, or deleted by the CLI or any automated tooling
- Consumer-managed fields in `opensdd.json` MUST survive all update operations
- Every installed dependency spec MUST have both a directory in `deps_dir` and an entry in `opensdd.json` `dependencies`
- All behaviors described in the spec MUST be thoroughly tested by the implementing agent
- A `spec.md` MUST contain an H1 header with blockquote summary and a `## Behavioral Contract` section
- `deviations.md` MUST only be created when a deviation actually exists
- Every dependency implementation MUST be accompanied by a generated test suite that passes
- The test suite MUST thoroughly cover all behaviors described in the spec (minus documented deviations)
- The `.opensdd.deps/` directory MUST be committed to the repo
- Publishing MUST NOT allow overwriting an existing version in the registry
