import { describe, expect, it } from "vitest";

import {
  AutoWorkspaceProvider,
  DockerWorkspaceProvider,
  K8sWorkspaceProvider,
  LocalWorkspaceProvider,
} from "../src/index.js";

/**
 * Selection logic only — no Docker required. `mode` short-circuits detection,
 * which is exactly the seam that lets this stay a fast unit test.
 */
describe("AutoWorkspaceProvider", () => {
  it("uses Docker when forced, without warning", async () => {
    const warnings: string[] = [];
    const provider = new AutoWorkspaceProvider({ mode: "docker", warn: (m) => warnings.push(m) });
    expect(await provider.preflight()).toBe("docker");
    expect(warnings).toEqual([]);
  });

  it("warns loudly when falling back to the unsandboxed local provider", async () => {
    const warnings: string[] = [];
    const provider = new AutoWorkspaceProvider({ mode: "local", warn: (m) => warnings.push(m) });
    expect(await provider.preflight()).toBe("local");
    expect(warnings).toHaveLength(1);
    // The warning has to actually say the dangerous thing, not just "note:".
    expect(warnings[0]).toMatch(/UNSANDBOXED/);
    expect(warnings[0]).toMatch(/untrusted/i);
  });

  it("detects once and caches, even under concurrent first use", async () => {
    const warnings: string[] = [];
    const provider = new AutoWorkspaceProvider({ mode: "local", warn: (m) => warnings.push(m) });
    await Promise.all([provider.preflight(), provider.preflight(), provider.preflight()]);
    // A per-call warning would spam the operator into ignoring it.
    expect(warnings).toHaveLength(1);
  });

  it("exposes both concrete providers for explicit wiring", () => {
    expect(new LocalWorkspaceProvider()).toBeInstanceOf(LocalWorkspaceProvider);
    expect(new DockerWorkspaceProvider()).toBeInstanceOf(DockerWorkspaceProvider);
  });
});

describe("AutoWorkspaceProvider in-cluster selection", () => {
  it("prefers k8s over docker when forced, without warning", async () => {
    const warnings: string[] = [];
    // In a pod there is no docker socket. If docker were checked first, the
    // room would silently fall back to one shared filesystem for every session.
    const provider = new AutoWorkspaceProvider({
      mode: "k8s",
      warn: (m) => warnings.push(m),
      token: "fake-token",
      apiServer: "https://example.invalid",
      namespace: "agentbe",
    });
    expect(await provider.preflight()).toBe("k8s");
    expect(warnings).toEqual([]);
  });

  it("K8sWorkspaceProvider refuses to construct without a token", () => {
    expect(() => new K8sWorkspaceProvider({ apiServer: "https://example.invalid" })).toThrow(
      /service-account token/,
    );
  });
});
