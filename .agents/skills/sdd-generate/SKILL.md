# SDD Generate

> Guides an AI agent through analyzing a repository and generating a behavioral spec in the OpenSDD format.

## Overview

Handles large repos via a multi-pass, artifact-driven strategy that survives context window clears. This document defines the workflow that the sdd-generate skill teaches agents to follow. The skill is installed into each supported coding agent's configuration directory via `opensdd init`.

## Prerequisites

Before starting, you need:

1. A **target repository** — a GitHub URL or local path provided by the user.
2. A **scope** — which capability, module, or function to spec. If the user provides a whole-repo URL without scoping, ask them to narrow it before proceeding. A spec for "the entire lodash library" is not useful. A spec for "lodash's string slugification" is.
3. The **spec-format reference** — read [spec-format.md](spec-format.md) to understand the required output structure.
4. A **working directory** — confirm with the user where the generated spec should be written. If the project has `opensdd.json`, use the directory specified by `specs_dir` (default: `opensdd/`). If the project is not yet initialized, ask the user where to output the spec — a common default is `opensdd/` in the current project root. The agent does not need `opensdd.json` to exist before generating a spec.

## Output

A spec written to the working directory:

```
opensdd/
  spec.md           # Behavioral contract
```

The spec author MAY include additional files in the output directory (e.g., supplementary schema definitions in a `references/` subdirectory). The protocol does not mandate any particular structure beyond `spec.md` — organization of supplementary files is at the author's discretion. If you create supplementary files, use relative markdown hyperlinks from `spec.md` to reference them so the spec is self-navigating — an agent starts at `spec.md` and follows links to discover everything it needs.

If `opensdd.json` exists, add or update the `publish` object:

```json
{
  "publish": {
    "name": "{name}",
    "version": "{semver}",
    "description": "{one-line description}",
    "spec_format": "0.1.0",
    "dependencies": []
  }
}
```

## Strategy: Multi-Pass Artifact-Driven Generation

Large repositories exceed a single context window. The strategy is to **write to disk as you go** — not at the end. Each pass reads from the repo and writes to the output spec directory or to scratch notes. If context clears, read your own artifacts to resume.

### Working artifacts

Maintain a `_notes/` scratch directory alongside the output spec in your working directory during generation:

```
{working-directory}/
  _notes/
    scope.md        # What we're spec'ing, which files matter
    inventory.md    # Public API surface, function signatures, types
    examples.md     # Extracted inline examples from tests
    gaps.md         # Behaviors not yet covered, open questions
  spec.md           # Built up incrementally
```

`_notes/` is your working memory across context clears. Delete it before finalizing.

### Context recovery

If you are resuming after a context clear:

1. Read `_notes/scope.md` to understand what you're spec'ing and where you are.
2. Read `_notes/gaps.md` to see what remains.
3. Read the current `spec.md` draft to see what's been written.
4. Continue from the next incomplete pass.

Always update `_notes/gaps.md` at the end of each pass with what still needs to be done, so a fresh context can pick up cleanly.

### Pass 1: Reconnaissance

**Goal:** Understand what the repo does and map the territory for the scoped capability.

**Read (in this order):**
- README and top-level documentation
- Package manifest (package.json, pyproject.toml, Cargo.toml, go.mod) for dependencies, version, description
- Directory structure (just the tree, not file contents)
- Changelog or release notes if present (for understanding version history)

**Write:**
- `_notes/scope.md` — what the repo is, what capability we're spec'ing, which directories/files are relevant to that capability, which are not. Include the spec name, version (use the repo's version or `0.1.0`), and description for later use in the `opensdd.json` `publish` object.
- `opensdd/spec.md` — Header (H1 + blockquote) and `## Overview` only

**Do NOT read** source code or tests yet. The goal is orientation, not comprehension.

### Pass 2: Surface Area

**Goal:** Identify the public API — what the outside world interacts with.

**Read (in this order):**
- Type definitions, interfaces, and exported symbols for the scoped capability
- Public function/method signatures with their parameter and return types
- Configuration types, options objects, builder patterns
- If the repo has OpenAPI, protobuf, GraphQL, or JSON Schema files relevant to the scope, read those

**Write:**
- `_notes/inventory.md` — complete list of public API surface: every exported function, class, type, constant. Include signatures. This is your checklist — every item here must appear in the spec's behavioral contract.
- `spec.md` — add `## Behavioral Contract` skeleton with H3 subsection headers for each logical grouping of API surface. No behavioral descriptions yet, just the structure.
- If formal schema files are found (OpenAPI, protobuf, JSON Schema, etc.), consider copying them into the spec directory as supplementary reference files (e.g., in a `references/` subdirectory).

### Pass 3: Behavior Extraction

**Goal:** Extract concrete behaviors from tests. Tests are the richest source of behavioral truth — they show what the code actually does with real inputs and outputs.

**Read:**
- Test files for the scoped capability, starting with unit tests, then integration tests
- For each test, identify: what input is given, what output or behavior is asserted, what edge case is being covered

**Write:**
- `_notes/examples.md` — every concrete input/output pair and scenario extracted from tests, grouped by the behavioral subsection it belongs to
- `spec.md` — fill in Behavioral Contract subsections with:
  - Behavioral descriptions (what happens, not how)
  - Inline examples extracted from tests (converted to spec format)
  - `## Edge Cases` section with concrete examples from edge case tests
- `_notes/gaps.md` — which inventory items have no test coverage, which behavioral subsections still need examples

**Guidance on extracting behavior from tests:**
- A test assertion like `expect(slugify("Hello World")).toBe("hello-world")` becomes the inline example `slugify("Hello World")` MUST return `"hello-world"`
- A test that mocks internal implementation details is telling you about a dependency boundary, not a behavior to spec
- A test that checks error throwing tells you about an error path to include
- Property-based tests translate directly into Invariants
- Parameterized tests are dense sources of edge cases

### Pass 4: Gap Filling

**Goal:** Cover behaviors not captured by tests. Read source code only now, and only for gaps.

**Read:**
- Source code for behaviors listed in `_notes/gaps.md`
- Error handling paths (try/catch, error returns, validation logic)
- Default values and configuration handling
- Any inline comments describing "why" (these often reveal behavioral intent)

**Write:**
- `spec.md` — fill remaining Behavioral Contract gaps, add any discovered edge cases, add `## Options / Configuration` if the capability has configurable parameters
- `_notes/gaps.md` — update with any remaining unknowns

**Guidance on separating what from how:**
- Source says `str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')` — spec says "converts to lowercase, replaces non-alphanumeric characters with hyphens, strips leading/trailing hyphens"
- Source uses a trie for prefix matching — spec says "matches the longest matching prefix"
- Source caches results in a Map — this is implementation detail, do NOT spec it (mention in NOT Specified or Implementation Hints)
- Source validates input with a regex — spec says "MUST reject inputs not matching pattern X" (the constraint matters, the mechanism doesn't)

### Pass 5: Completion

**Goal:** Fill in recommended sections, self-validate, finalize.

**Read:**
- The full `spec.md` draft
- `_notes/inventory.md` — verify every public API item is covered
- `_notes/gaps.md` — verify no critical gaps remain
- [spec-format.md](spec-format.md) — verify structural compliance

**Write:**
- `spec.md` — add or complete:
  - `## NOT Specified (Implementation Freedom)` — list implementation choices observed in the source that the spec intentionally leaves open (data structures, algorithms, caching, internal architecture)
  - `## Invariants` — universal properties extracted from property tests, type constraints, or behavioral patterns (e.g., idempotency, commutativity, output format guarantees)
  - `## Implementation Hints` (optional) — guidance on performance, concurrency, or common pitfalls observed in the source, only if genuinely useful. If the spec targets a specific platform, hints MAY be platform-specific; otherwise they SHOULD be language-agnostic.
- If `opensdd.json` exists, add or update the `publish` object with name, version, description, spec_format, and dependencies from `_notes/scope.md`.

**Validate the output:**
- MUST have H1 header with blockquote summary and `## Behavioral Contract`
- Behavioral Contract subsections MAY include inline examples or narrative scenarios where the behavior benefits from concrete demonstration
- If an Edge Cases section is present, it SHOULD have concrete examples (not just descriptions)
- NOT Specified and Invariants sections SHOULD be present — they are recommended but not required
- Invariants SHOULD be expressed as testable assertions when present
- No implementation details (specific algorithms, data structures, internal architecture) in the Behavioral Contract

**Clean up:**
- Delete `_notes/` directory entirely
- Verify the output directory is a valid spec: contains `spec.md`

## Specs with Subcomponents

If the scoped capability has natural subcomponents (e.g., multiple provider integrations, platform adapters), consider organizing the spec with supplementary files for each component. For example:

```
opensdd/
  spec.md              # Shared behavioral contract
  components/
    {component-a}.md   # Component-specific contract
    {component-b}.md
```

This is an organizational pattern, not a protocol requirement — the protocol only mandates `spec.md`. Choose whatever file organization makes the spec easiest to read and maintain. `spec.md` MUST link to all component files using relative markdown hyperlinks so the spec is self-navigating.

Run passes 2-4 for the shared contract first, then for each component. The shared `spec.md` should capture behavior common to all components. Component-level files capture only what differs.

Update `_notes/scope.md` to track which components have been completed so context clears don't cause rework.

## Handling Very Large Repos

For repos where even a single pass exceeds context:

- **Narrow the scope further.** Ask the user to target a specific module or subdirectory rather than a broad capability.
- **Split passes into sub-passes.** For Pass 3 (behavior extraction), process one test file at a time, writing to `_notes/examples.md` after each. The notes file accumulates across sub-passes.
- **Use `_notes/gaps.md` as a work queue.** Write remaining file paths to process. Pick up the next unprocessed file after each context clear.
- **Prioritize depth over breadth.** A thorough spec of a smaller scope is more valuable than a shallow spec of a large scope.

## What This Skill Does NOT Do

- Publish specs to a registry (use `opensdd publish` to validate and publish)
- Generate implementations from specs (that's the sdd-manager skill)
- Modify the source repository in any way
- Make judgments about code quality — the spec captures behavior as-is, not as it should be
