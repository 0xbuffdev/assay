import { release } from "node:os";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  decodeSerializedRecord,
  evaluate,
  projectPublicResult,
  type ValidationResult,
  verifyReferenceBundle,
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
    measure(
      "262144 transport bytes / 4096 nodes / multibyte",
      () => decodeSerializedRecord(input),
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

  it("measures a maximum snapshot budget of distinct protected structured references", () => {
    // Independent accounting from ASY-38: names and string values count,
    // but JSON punctuation, numeric primitives and array indices do not.
    function countedBytes(value: unknown): number {
      if (typeof value === "string") return Buffer.byteLength(value, "utf8");
      if (Array.isArray(value)) {
        return value.reduce<number>((sum, item) => sum + countedBytes(item), 0);
      }
      if (value !== null && typeof value === "object") {
        return Object.entries(value).reduce(
          (sum, [key, item]) => sum + Buffer.byteLength(key, "utf8") + countedBytes(item),
          0,
        );
      }
      return 0;
    }

    const count = 64;
    function fixture(payloadBytes: number) {
      const values = Array.from({ length: count }, (_, i) => ({
        ordinal: i,
        payload: "x".repeat(
          Math.floor(payloadBytes / count) + (i === count - 1 ? payloadBytes % count : 0),
        ),
      }));
      const records = values.map((value, i) =>
        unwrap(
          createReferenceRecord({
            schemaVersion: 2,
            referenceId: `protected-${i}`,
            kind: "json",
            value,
          }),
        ),
      );
      const rubric = unwrap(
        createAssessmentDefinition({
          schemaVersion: 2,
          assessmentId: "protected-resource",
          revision: "v1",
          policyVersion: "all-required-v1",
          criteria: records.map((record, i) => ({
            id: `fact-${i}`,
            mode: "required",
            visibility: "restricted",
            kind: "json_equality",
            parameters: {
              expected: {
                type: "reference",
                referenceId: record.referenceId,
                referenceDigest: record.referenceDigest,
              },
            },
          })),
        }),
      );
      const evidence = unwrap(
        createEvidenceBundle(rubric, {
          schemaVersion: 2,
          observations: values.map((value, i) => ({
            criterionId: `fact-${i}`,
            evidenceRef: `obs-${i}`,
            kind: "json",
            completeness: "complete",
            value,
          })),
        }),
      );
      const references = {
        schemaVersion: 2,
        definition: evidence.definition,
        references: records,
      };
      return { rubric, evidence, references };
    }

    const empty = fixture(0);
    const snapshotCap = 262_144;
    const payloadBytes = snapshotCap - countedBytes(empty.references);
    const exact = fixture(payloadBytes);
    const over = fixture(payloadBytes + 1);
    expect(countedBytes(exact.references)).toBe(snapshotCap);
    expect(countedBytes(over.references)).toBe(snapshotCap + 1);
    expect(new Set(over.references.references.map((record) => record.referenceId)).size).toBe(
      count,
    );
    expect(verifyReferenceBundle(exact.rubric, exact.references).ok).toBe(true);

    // Each over-budget record is individually sealed and bound to its own
    // definition. Removing the last record makes the same bundle admissible.
    expect(
      verifyReferenceBundle(over.rubric, {
        ...over.references,
        references: over.references.references.slice(0, -1),
      }).ok,
    ).toBe(true);
    console.info("AY-I24 protected reference workload shape", {
      criteria: count,
      referenceRecords: count,
      observations: count,
      payloadBytes,
      referenceSnapshotBytes: countedBytes(exact.references),
      overReferenceSnapshotBytes: countedBytes(over.references),
      definitionSnapshotBytes: countedBytes(exact.rubric),
      evidenceSnapshotBytes: countedBytes(exact.evidence),
      referenceSerializedBytes: Buffer.byteLength(JSON.stringify(exact.references), "utf8"),
    });
    // This is the admitted object-input path, not a serialized transport test.
    measure(
      "evaluate 64 protected structured references / 262144 snapshot bytes",
      () => evaluate(exact.rubric, exact.evidence, exact.references),
      (result) => {
        expect(result.outcome).toBe("pass");
        if (!("findings" in result)) throw new Error("Expected complete result");
        expect(result.findings).toHaveLength(count);
        for (const [i, finding] of result.findings.entries()) {
          expect(finding).toMatchObject({
            criterionId: `fact-${i}`,
            outcome: "pass",
            reasonCode: "MATCH",
          });
        }
        expect(projectPublicResult(exact.rubric, result)).toEqual({
          ok: true,
          value: { schemaVersion: 1, outcome: "withheld", findings: [] },
        });
      },
    );
    const rejected = evaluate(over.rubric, over.evidence, over.references);
    expect(rejected).toMatchObject({
      outcome: "invalid_reference",
      diagnostics: [{ code: "INPUT_TOO_LARGE" }],
    });
    expect(rejected).not.toHaveProperty("findings");
    expect(JSON.stringify(rejected)).not.toContain("protected-");
  });
});
