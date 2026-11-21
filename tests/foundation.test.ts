import { describe, expect, it } from "vitest";

import * as assay from "../src/index";

describe("Assay independent contract package", () => {
  it("exposes only versioned contract validation, not an unimplemented evaluator", () => {
    expect(Object.keys(assay).sort()).toEqual(
      [
        "ASSAY_SCHEMA_VERSION",
        "CONTRACT_LIMITS",
        "inspectEvidenceCoverage",
        "parseAssessmentDefinition",
        "parseEvaluationResult",
        "parseEvidenceBundle",
      ].sort(),
    );
    expect("evaluate" in assay).toBe(false);
  });

  it("imports without a runner, host, network or model provider", async () => {
    const entry = await import("../src/index");
    expect(entry.parseAssessmentDefinition).toBeTypeOf("function");
    expect(entry.parseEvidenceBundle).toBeTypeOf("function");
  });
});
