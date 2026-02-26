---
applyTo: "**"
---

# SDD Manager

> Teaches agents how to implement, update, and verify installed dependency specs in an OpenSDD-compliant project.

## Overview

The sdd-manager skill is installed once per project via `opensdd init` alongside the sdd-generate skill, into each supported coding agent's configuration directory. It teaches agents four workflows: implementing a spec, processing a spec update, checking conformance, and creating deviations. It also defines universal implementation defaults, the project conventions check, and the verification protocol that apply to all spec implementations.

This skill is the required entry point whenever an agent reads an installed OpenSDD dependency spec to make changes to the project — whether that is a first implementation, an incremental update, a conformance check, or a deviation. The agent MUST NOT implement or modify code based on an OpenSDD spec outside of the workflows defined here.

## Spec as Source of Truth

The dependency spec (`spec.md`) is the authoritative description of what to build. It is already a carefully structured behavioral contract with precise language, edge cases, and constraints. The agent MUST treat it as the primary reference throughout all workflows and MUST NOT replace it with a self-generated substitute.

**Do not rewrite the spec into a plan.** The agent MUST NOT translate spec requirements into its own planning format (todo lists, step-by-step plans, internal summaries, etc.) as a substitute for the spec itself. Such translations are inherently lossy — they flatten nuance, drop edge cases, and shift intent. The spec's behavioral contract already defines what to build; duplicating it in another format adds no value and introduces drift.

**Re-read the spec directly.** During implementation, the agent MUST re-read relevant sections of `spec.md` directly rather than working from a self-generated summary or plan. If the agent's context window requires chunking work across multiple passes, it MUST chunk by spec section and re-read each section from the file before implementing it — not from memory or prior notes.

**Plans are for additive context only.** If the agent uses planning tools (todo lists, scratchpads, plan mode, etc.), those plans MUST be limited to information that is _not_ in the spec: project-specific decisions (file paths, module structure, integration points), target language and framework details, implementation ordering, and deviations. Plans SHOULD reference spec sections by name rather than restating their content.

## Workflows

### Implement

1. **Read:** Read the dependency spec from `.opensdd.deps/<name>/` (`spec.md` and any supplementary files), `deviations.md` (if it exists), and other dependency specs it depends on.

2. **Clarify (pre-implementation Q&A):** Before writing any code, the agent MUST walk the user through the spec's scope and structure and solicit clarifications. The agent MUST:
   - Present the spec's behavioral sections and their scope (key behaviors, components, options) — referencing the spec's own structure rather than generating a lossy re-summary.
   - List any ambiguities, underspecified areas, or decisions that require user input (e.g., where to place files, which optional behaviors to include, how to integrate with existing code).
   - Ask whether the user wants to deviate from any behaviors upfront. Present the spec's major behavioral groups and ask: "Do you want to skip, modify, or narrow any of these?" If the user identifies deviations, create `deviations.md` entries before proceeding to implementation.
   - The agent MUST NOT proceed to implementation until the user has responded. A response of "no clarifications, proceed" or equivalent is sufficient.

3. **Conventions check:** Perform the project conventions check (see Project Conventions Check section below).

4. **Implement:** Generate the implementation applying universal defaults (see Universal Implementation Defaults section below).

5. **Verify:** Execute the full verification protocol (see Verification Protocol section below): generate test suite → run tests until all pass (or SHOULD bail after 50 attempts) → dispatch subagent for spec compliance audit → fix any findings → re-run tests.

6. **Record:** Update `opensdd.json` `dependencies` entry with `implementation` path, `tests` path, and `has_deviations` if applicable.

7. **Report:** Report results with spec coverage summary.

### Update

1. Read `changeset.md` from `.opensdd.deps/.updates/<name>/` → identify which behavioral sections changed.
2. Read `deviations.md` (if it exists in `.opensdd.deps/<name>/`) and flag any deviations that reference changed sections as potentially stale.
3. Present the changes to the user: summarize what changed, flag stale deviations, and ask whether the user wants to adjust any deviations before proceeding.
4. Patch implementation to conform to the new behavioral contract.
5. Regenerate affected tests → run until all pass → dispatch subagent for spec compliance audit scoped to the changed sections → fix any findings → re-run tests.
6. Tell the user to run `opensdd update apply <name>` to finalize the update in `opensdd.json`. The agent MUST always specify the spec name explicitly — it MUST NOT suggest or use the no-args batch form (`opensdd update apply` without a name).

### Check Conformance

Run existing test suite → report pass/fail. If test suite is missing or stale, regenerate from spec and re-run. After tests pass, dispatch subagent for spec compliance audit → report any compliance issues found.

### Create Deviation

Determine affected spec section → classify type → create/append to `deviations.md` in `.opensdd.deps/<name>/` → update test suite to skip affected tests → update `has_deviations` in `opensdd.json`.

## Universal Implementation Defaults

Quality floors that apply to every spec implementation, regardless of language or project. These exist to maximize the chance of a correct implementation on the first attempt. The sdd-manager skill MUST instruct the agent to follow these defaults.

**Typing and type safety:**
- The agent MUST use the strongest type system available in the target language. In Python, this means type annotations with strict mypy-compatible types. In JavaScript projects, the agent SHOULD prefer TypeScript if the project supports it.
- All public function signatures MUST have fully typed parameters and return types.
- The agent SHOULD use narrow types over broad ones (e.g., `str` over `Any`, specific union types over generic ones).
- The agent MUST NOT use type suppression features (`# type: ignore`, `@ts-ignore`, `// nolint`, `as any`, etc.) unless there is no type-safe alternative. If used, the agent MUST include a comment explaining why.

**Error handling:**
- All error paths defined in the spec MUST be handled explicitly. The agent MUST NOT silently swallow errors.
- Errors SHOULD use the language's idiomatic error mechanism (exceptions in Python/JS/Java, Result types in Rust, error returns in Go).
- Public boundary inputs MUST be validated. Internal calls between trusted functions MAY skip validation.

**Code structure:**
- The agent SHOULD prefer pure functions where the spec does not require state or side effects.
- The agent MUST NOT introduce global mutable state unless the spec explicitly requires it.
- The implementation SHOULD be contained in as few files as makes sense for the project's conventions.

**Defensiveness:**
- The agent MUST handle null/nil/undefined inputs gracefully when the spec defines edge case behavior for them.
- The agent SHOULD prefer standard library over third-party dependencies where both satisfy the spec equivalently.
- The agent MUST NOT introduce dependencies not already present in the project without flagging this to the user.

## Project Conventions Check

Before implementing a spec, the agent MUST determine the target language and check whether the project has sufficient coding conventions defined (in CLAUDE.md, cursor rules, AGENTS.md, or equivalent): target language/version, code style, module organization, testing framework, and error handling patterns.

If the spec declares a target language, runtime, or framework, the agent MUST use that as the starting point. If the spec does not declare a target platform, the agent infers it from the project context.

If the project lacks clear conventions, the agent MUST prompt the user to specify preferences or explicitly opt for best-judgment inference. The agent MUST NOT proceed until the user responds.

## Verification Protocol

The agent MUST verify its implementation through two complementary methods: a generated test suite and a spec compliance audit performed by a subagent.

### Test Suite

The agent MUST generate a persisted test file in the project's testing framework that thoroughly covers all behaviors described in the spec, including edge cases, error conditions, and invariants. The spec itself defines what constitutes thorough coverage — the agent should use its judgment to ensure all described behaviors are tested.

The agent MUST run the tests after implementation, fix and re-run until all pass, and report spec coverage. The agent SHOULD abandon the fix-and-rerun cycle after 50 attempts and report the remaining failures to the user. The test file path MUST be tracked in `opensdd.json` under the dependency's `tests` field and be runnable via the project's standard test command.

When `deviations.md` exists, the agent MUST skip tests for deviated behaviors and note the skips in the test file referencing the deviation.

### Spec Compliance Audit

After the test suite passes, the agent MUST dispatch a subagent to perform an independent spec compliance audit. The audit catches classes of issues that tests alone miss — incorrect ordering of operations, missing guards, wrong defaults, incomplete error handling, and subtle deviations from the spec's behavioral contract.

The agent MUST dispatch the subagent with these instructions:

1. **Read the full spec.** Read `spec.md` and all supplementary files linked from it. Read `deviations.md` if it exists.
2. **Read the full implementation.** Read every implementation file produced for this spec.
3. **Walk each behavioral contract section.** For each section in the spec's `## Behavioral Contract`, verify:
   - Every MUST requirement is satisfied in the implementation
   - Every SHOULD requirement is either satisfied or has a justified reason for omission
   - The ordering of operations matches the spec when the spec prescribes a specific order
   - Error handling matches the spec's defined error paths and exit conditions
   - Edge cases enumerated in the spec are handled
4. **Check invariants.** For each invariant listed in the spec's `## Invariants` section, verify the implementation upholds it.
5. **Check omissions.** Verify that behaviors the spec says MUST NOT happen are not present in the implementation (e.g., the implementation does not create files the spec forbids, does not modify data the spec says is read-only).
6. **Skip deviated behaviors.** If `deviations.md` exists, do not flag deviated behaviors as compliance issues.
7. **Report findings.** Return a structured list of compliance issues found, each with:
   - The spec section it relates to
   - What the spec requires
   - What the implementation does instead
   - Severity (violation of MUST vs. SHOULD vs. minor discrepancy)

The subagent MUST NOT modify any files — it is read-only. It reports findings back to the primary agent.

Upon receiving the audit results, the primary agent MUST:
- Fix all MUST-level violations
- Evaluate SHOULD-level issues and fix or document as appropriate
- Re-run the test suite after any fixes to confirm no regressions
- If fixes were made, dispatch the subagent for one additional audit pass to verify the fixes (a single re-audit is sufficient — do not loop indefinitely)
