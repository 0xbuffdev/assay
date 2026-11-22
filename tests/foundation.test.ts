import { describe, expect, it } from "vitest";

import * as assay from "../src/index";

describe("Assay independent contract package", () => {
  it("exposes validated contracts and the pure deterministic evaluator", () => {
    expect(Object.keys(assay).sort()).toEqual(
      [
        "ASSAY_EVALUATOR_VERSION",
        "ASSAY_SCHEMA_VERSION",
        "CONTRACT_LIMITS",
        "evaluate",
        "inspectEvidenceCoverage",
        "parseAssessmentDefinition",
        "parseEvaluationResult",
        "parseEvidenceBundle",
      ].sort(),
    );
    expect(assay.evaluate).toBeTypeOf("function");
  });

  it("imports without a runner, host, network or model provider", async () => {
    const entry = await import("../src/index");
    expect(entry.parseAssessmentDefinition).toBeTypeOf("function");
    expect(entry.parseEvidenceBundle).toBeTypeOf("function");
    expect(entry.evaluate).toBeTypeOf("function");
  });
});
