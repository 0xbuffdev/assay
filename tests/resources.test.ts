import { release } from "node:os";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createAssessmentDefinition,
  createEvidenceBundle,
  decodeSerializedRecord,
  evaluate,
  projectPublicResult,
  type ValidationResult,
} from "../src/index";

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error("Invalid resource fixture");
  return result.value;
}

// Sample a fixed workload, including a warm-up. No timing or memory threshold
// depends on the CI machine. Heap deltas are not peak allocations; maxRSS is
// the cumulative process high-water mark, not the isolated workload's peak.
function measure<T>(name: string, run: () => T, verify: (result: T) => void): void {
  verify(run());
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const before = process.memoryUsage();
    const start = performance.now();
    const result = run();
    const elapsedMs = performance.now() - start;
    const after = process.memoryUsage();
    samples.push({
      elapsedMs,
      heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssDeltaBytes: after.rss - before.rss,
    });
    verify(result);
  }
  console.info("AY-I24 resource measurement", {
    name,
    commit: process.env.GITHUB_SHA ?? "local: record git rev-parse HEAD",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    samples,
    maxElapsedMs: Math.max(...samples.map((sample) => sample.elapsedMs)),
    processMaxRssKiB: process.resourceUsage().maxRSS,
  });
}

const transportCap = 262_144;

function padTransport(json: string): string {
  const bytes = Buffer.byteLength(json, "utf8");
  return json + " ".repeat(transportCap - bytes);
}

describe("AY-I24 resource conformance and measurement", () => {
  it("measures accepted maximum transport and node count, and adjacent rejection", () => {
    // Root + containing array + 32 child arrays + 4062 leaves = 4096 nodes.
    const nodes = Array.from({ length: 32 }, (_, i) =>
      Array(i === 31 ? 94 : 128).fill("é".repeat(30)),
    );
    const input = padTransport(JSON.stringify({ nodes }));
    expect(Buffer.byteLength(input, "utf8")).toBe(transportCap);
    measure("262144 transport bytes / 4096 nodes / multibyte", () => decodeSerializedRecord(input),
      (result) => expect(result.ok).toBe(true),
    );
    expect(decodeSerializedRecord(`${input} `)).toEqual({
      ok: false,
      diagnostics: [{ path: "$", code: "INPUT_TOO_LARGE" }],
    });
    nodes[31].push("x");
    expect(decodeSerializedRecord(JSON.stringify({ nodes }))).toEqual({
      ok: false,
      diagnostics: [{ path: "$", code: "INPUT_TOO_LARGE" }],
    });
  });

  it("measures escape-heavy strings and maximum nesting with adjacent failures", () => {
    const escaped = "\\u0061".repeat(16_384);
    const json = `{"x":["${escaped}","${escaped}"]}`;
    const input = padTransport(json);
    expect(Buffer.byteLength(input, "utf8")).toBe(transportCap);
    measure(
      "262144 transport bytes / two 16384-unit escaped strings",
      () => decodeSerializedRecord(input),
      (result) => {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Expected decoded strings");
        expect(result.value.x).toEqual(["a".repeat(16_384), "a".repeat(16_384)]);
      },
    );
    expect(decodeSerializedRecord(`{"x":"${escaped}a"}`)).toEqual({
      ok: false,
      diagnostics: [{ path: "$", code: "INPUT_TOO_LARGE" }],
    });
    const nested = (depth: number) => `${'{"x":'.repeat(depth)}0${"}".repeat(depth)}`;
    measure(
      "12-level nested record",
      () => decodeSerializedRecord(nested(12)),
      (result) => expect(result.ok).toBe(true),
    );
    expect(decodeSerializedRecord(nested(13))).toEqual({
      ok: false,
      diagnostics: [{ path: "$", code: "INPUT_TOO_DEEP" }],
    });
  });

  it("measures sealing, evaluation and projection for 64 large required criteria", () => {
    const criteria = Array.from({ length: 64 }, (_, i) => ({
      id: `fact-${i}`,
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: String(i).padStart(3_800, "x") } },
    }));
    const draft = {
      schemaVersion: 2,
      assessmentId: "resource",
      revision: "v1",
      policyVersion: "all-required-v1",
      criteria,
    };
    const rubric = unwrap(createAssessmentDefinition(draft));
    const evidenceDraft = {
      schemaVersion: 2,
      observations: criteria.map((criterion, i) => ({
        criterionId: criterion.id,
        evidenceRef: `obs-${i}`,
        kind: "text",
        completeness: "complete",
        value: criterion.parameters.expected.value,
      })),
    };
    const evidence = unwrap(createEvidenceBundle(rubric, evidenceDraft));
    measure(
      "seal 64 criteria / 243200 expected string bytes",
      () => createAssessmentDefinition(draft),
      (result) => expect(unwrap(result).revisionDigest).toBe(rubric.revisionDigest),
    );
    measure(
      "seal 64 observations / 243200 observed string bytes",
      () => createEvidenceBundle(rubric, evidenceDraft),
      (result) => expect(unwrap(result).evidenceDigest).toBe(evidence.evidenceDigest),
    );
    const result = evaluate(rubric, evidence);
    measure(
      "evaluate 64 large criteria and evidence",
      () => evaluate(rubric, evidence),
      (replayed) => {
        expect(replayed.outcome).toBe("pass");
        expect(replayed).toEqual(result);
      },
    );
    measure(
      "project 64 public findings",
      () => projectPublicResult(rubric, result),
      (projected) => {
        expect(projected.ok).toBe(true);
        if (!projected.ok) throw new Error("Expected public result");
        expect(projected.value.outcome).toBe("pass");
        expect(projected.value.findings).toHaveLength(64);
      },
    );
    expect(
      createAssessmentDefinition({
        ...draft,
        criteria: [...criteria, { ...criteria[0], id: "extra" }],
      }).ok,
    ).toBe(false);
  });
});
