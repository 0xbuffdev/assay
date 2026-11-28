import { createHash } from "node:crypto";
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
  verifyEvidenceBundle,
} from "../src/index";

const CAP = 262_144;
const artifactDigest = `sha256:${"d".repeat(64)}`;
function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("Invalid AY-I27 workload");
  return result.value;
}

// Independent ASY-38 accounting: count names and UTF-8 string values, not
// punctuation or numbers; nodes include containers and primitive values.
function shape(value: unknown): { nodes: number; snapshotBytes: number; depth: number } {
  if (value === null || typeof value !== "object") {
    return {
      nodes: 1,
      snapshotBytes: typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0,
      depth: 0,
    };
  }
  const array = Array.isArray(value);
  const entries = Object.entries(value);
  let nodes = 1;
  let snapshotBytes = 0;
  let depth = 0;
  for (const [key, item] of entries) {
    const nested = shape(item);
    nodes += nested.nodes;
    snapshotBytes += nested.snapshotBytes + (array ? 0 : Buffer.byteLength(key, "utf8"));
    depth = Math.max(depth, nested.depth + 1);
  }
  return { nodes, snapshotBytes, depth };
}

function independentEvidence(content: unknown): string {
  const keys = new Set<string>();
  JSON.stringify(content, (_key, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item)) keys.add(key);
    }
    return item;
  });
  return `sha256:${createHash("sha256")
    .update("assay:evidence:v4\n")
    .update(JSON.stringify(content, [...keys].sort()), "utf8")
    .digest("hex")}`;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function measure<T>(name: string, workload: unknown, run: () => T, verify: (result: T) => void) {
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
  // One line makes the machine-specific observations reproducible in CI logs.
  // RSS high water is cumulative; no elapsed-time or heap threshold is imposed.
  console.info(
    "AY-I27 measurement",
    JSON.stringify({
      name,
      workload,
      commit: process.env.GITHUB_SHA ?? "local: record git rev-parse HEAD",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      samples,
      maxElapsedMs: Math.max(...samples.map((sample) => sample.elapsedMs)),
      processMaxRssKiB: process.resourceUsage().maxRSS,
    }),
  );
}

const leaf = (id: string) => ({ kind: "criterion", id });
const child = (id: string) => ({ kind: "group", id });

describe("AY-I27 expanded resource workloads", () => {
  it("measures the simultaneous graph limits and adjacent violations", () => {
    const criteria = Array.from({ length: 64 }, (_, i) => ({
      id: `c${i}`,
      kind: "exact_text",
      mode: "required",
      visibility: "public",
      parameters: { expected: { type: "literal", value: "ok" } },
    }));
    // Root: 7 direct leaves, 56 singleton children and one chain of 7 groups.
    // Thus 64 groups, 64 leaves, 64 root children, 127 edges, depth 8.
    const groups = [
      {
        id: "root",
        operator: "all",
        children: [
          ...criteria.slice(0, 7).map((c) => leaf(c.id)),
          ...Array.from({ length: 56 }, (_, i) => child(`single${i}`)),
          child("chain0"),
        ],
      },
      ...Array.from({ length: 56 }, (_, i) => ({
        id: `single${i}`,
        operator: i % 2 ? "any" : "all",
        children: [leaf(`c${i + 7}`)],
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `chain${i}`,
        operator: i % 2 ? "all" : "any",
        children: [i === 6 ? leaf("c63") : child(`chain${i + 1}`)],
      })),
    ];
    const authored = {
      schemaVersion: 4,
      assessmentId: "max-graph",
      revision: "rev1",
      policyVersion: "composed-required-v1",
      criteria,
      composition: { rootGroupId: "root", groups },
    };
    expect(groups).toHaveLength(64);
    expect(criteria).toHaveLength(64);
    expect(groups[0].children).toHaveLength(64);
    expect(groups.reduce((sum, g) => sum + g.children.length, 0)).toBe(127);
    const definition = unwrap(createAssessmentDefinition(authored));
    const draft = {
      schemaVersion: 4,
      observations: criteria.map((c) => ({
        criterionId: c.id,
        evidenceRef: `obs-${c.id}`,
        kind: "text",
        completeness: "complete",
        value: "ok",
      })),
    };
    const evidence = unwrap(createEvidenceBundle(definition, draft));
    const result = evaluate(definition, evidence);
    expect(result.outcome).toBe("pass");
    const workload = {
      groups: 64,
      requiredLeaves: 64,
      rootChildren: 64,
      edges: 127,
      groupDepth: 8,
      definition: shape(definition),
      evidence: shape(evidence),
      definitionSerializedBytes: serializedBytes(definition),
      evidenceSerializedBytes: serializedBytes(evidence),
    };
    measure(
      "maximum graph sealing",
      workload,
      () => createAssessmentDefinition(authored),
      (checked) => expect(unwrap(checked).revisionDigest).toBe(definition.revisionDigest),
    );
    measure(
      "maximum graph evaluation and projection",
      workload,
      () => {
        const full = evaluate(definition, evidence);
        return { full, projected: projectPublicResult(definition, full) };
      },
      ({ full, projected }) => {
        expect(full).toEqual(result);
        expect(unwrap(projected).findings).toHaveLength(64);
        expect(unwrap(projected).outcome).toBe("pass");
      },
    );
    const overEdges = groups.map((g) =>
      g.id === "single0" ? { ...g, children: [...g.children, leaf("c7")] } : g,
    );
    expect(
      createAssessmentDefinition({
        ...authored,
        composition: { ...authored.composition, groups: overEdges },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ path: "$.composition", code: "TOO_MANY_ITEMS" }],
    });
    const deeper = groups.map((g) =>
      g.id === "root"
        ? { ...g, children: g.children.filter((c) => c.id !== "single0") }
        : g.id === "chain6"
          ? { ...g, children: [...g.children, child("single0")] }
          : g,
    );
    expect(
      createAssessmentDefinition({
        ...authored,
        composition: { ...authored.composition, groups: deeper },
      }).ok,
    ).toBe(false);
    for (const invalid of [
      { ...authored, criteria: [...criteria, { ...criteria[0], id: "extra" }] },
      {
        ...authored,
        composition: {
          ...authored.composition,
          groups: [...groups, { ...groups[1], id: "extra" }],
        },
      },
      {
        ...authored,
        composition: {
          ...authored.composition,
          groups: groups.map((g) =>
            g.id === "root" ? { ...g, children: [...g.children, leaf("c0")] } : g,
          ),
        },
      },
    ])
      expect(createAssessmentDefinition(invalid).ok).toBe(false);
  });

  it("measures 63 maximum-citation reviews at the exact combined evidence snapshot limit", () => {
    const reference = unwrap(
      createReferenceRecord({
        schemaVersion: 4,
        referenceId: "protected",
        kind: "text",
        value: "ok",
      }),
    );
    const objective = {
      id: "objective",
      kind: "exact_text",
      mode: "required",
      visibility: "restricted",
      parameters: {
        expected: {
          type: "reference",
          referenceId: reference.referenceId,
          referenceDigest: reference.referenceDigest,
        },
      },
    };
    const reviewCriteria = Array.from({ length: 63 }, (_, i) => ({
      id: `review${i}`,
      kind: "qualitative_review",
      mode: "advisory",
      visibility: "public",
      parameters: { reviewPolicyId: "design", reviewPolicyVersion: "rev1" },
    }));
    const definition = unwrap(
      createAssessmentDefinition({
        schemaVersion: 4,
        assessmentId: "max-review",
        revision: "rev1",
        policyVersion: "composed-required-v1",
        criteria: [objective, ...reviewCriteria],
        composition: {
          rootGroupId: "root",
          groups: [{ id: "root", operator: "all", children: [leaf("objective")] }],
        },
      }),
    );
    const fact = {
      criterionId: "objective",
      evidenceRef: "fact",
      kind: "text",
      completeness: "complete",
      value: "ok",
      origin: { kind: "independent", sourceRef: "fixture" },
    };
    function reviews(lengths: readonly number[]) {
      return reviewCriteria.map((c, i) => ({
        criterionId: c.id,
        evidenceRef: `obs-${c.id}`,
        kind: "qualitative_review",
        completeness: "complete",
        origin: { kind: "artifact", artifactDigest, sourceRef: "fixture" },
        ...c.parameters,
        reviewer: {
          kind: "model",
          providerId: "provider",
          modelId: "model",
          modelVersion: "rev1",
          promptId: "prompt",
          promptVersion: "rev1",
        },
        uncertainty: "unknown",
        feedback: "x".repeat(lengths[i]),
        citations: Array.from({ length: 8 }, (_, j) => ({
          artifactRef: "component",
          startByte: j,
          endByte: j + 1,
        })),
      }));
    }
    const lineage = {
      assessmentId: definition.assessmentId,
      revision: definition.revision,
      revisionDigest: definition.revisionDigest,
    };
    const references = { schemaVersion: 4, definition: lineage, references: [reference] };
    function content(lengths: readonly number[]) {
      return {
        schemaVersion: 4,
        artifactDigest,
        definition: lineage,
        observations: [fact, ...reviews(lengths)],
      };
    }
    function seal(lengths: readonly number[]) {
      const { definition: _lineage, ...draft } = content(lengths);
      return createEvidenceBundle(definition, draft);
    }
    const empty = { ...content(Array(63).fill(0)), evidenceDigest: `sha256:${"0".repeat(64)}` };
    const available = CAP - shape(empty).snapshotBytes;
    // One maximal 4096-byte review, distribute the remainder without crossing
    // the individual cap. The last review stays below it for a +1 byte probe.
    const rest = available - 4096;
    const lengths = [
      4096,
      ...Array.from({ length: 62 }, (_, i) => Math.floor(rest / 62) + (i < rest % 62 ? 1 : 0)),
    ];
    expect(lengths.every((n) => n > 0 && n <= 4096)).toBe(true);
    expect(lengths[62]).toBeLessThan(4096);
    const evidence = unwrap(seal(lengths));
    expect(shape(evidence).snapshotBytes).toBe(CAP);
    expect(shape(evidence).nodes).toBeLessThanOrEqual(4096);
    expect(shape(evidence).depth).toBeLessThanOrEqual(12);
    expect(evidence.evidenceDigest).toBe(independentEvidence(content(lengths)));
    const workload = {
      criteria: 64,
      reviews: 63,
      citations: 504,
      maxFeedbackBytes: 4096,
      feedbackBytes: available,
      definition: shape(definition),
      references: shape(references),
      evidence: shape(evidence),
      evidenceSerializedBytes: serializedBytes(evidence),
    };
    measure(
      "maximum review evidence sealing",
      workload,
      () => seal(lengths),
      (checked) => expect(unwrap(checked).evidenceDigest).toBe(evidence.evidenceDigest),
    );
    measure(
      "maximum review evidence verification and evaluation",
      workload,
      () => {
        const verified = verifyEvidenceBundle(definition, evidence);
        const result = evaluate(definition, evidence, references);
        return { verified, result, projected: projectPublicResult(definition, result) };
      },
      ({ verified, result, projected }) => {
        expect(verified.ok).toBe(true);
        expect(result.outcome).toBe("pass");
        if (!("findings" in result)) throw new Error("Expected complete review workload");
        expect(result.findings).toHaveLength(64);
        expect(
          result.findings
            .slice(1)
            .every((f) => f.outcome === "inconclusive" && f.reasonCode === "REVIEW_REQUIRED"),
        ).toBe(true);
        expect(unwrap(projected).outcome).toBe("withheld");
        expect(unwrap(projected).findings).toHaveLength(63);
      },
    );
    const tooManyBytes = [...lengths];
    tooManyBytes[62]++;
    const overContent = content(tooManyBytes);
    const over = { ...overContent, evidenceDigest: independentEvidence(overContent) };
    expect(shape(over).snapshotBytes).toBe(CAP + 1);
    expect(seal(tooManyBytes).ok).toBe(false);
    expect(evaluate(definition, over, references)).toMatchObject({
      outcome: "invalid_evidence",
      diagnostics: [{ code: "INPUT_TOO_LARGE" }],
    });

    // The full snapshot can exceed the separate transport ceiling due to
    // punctuation. Use smaller legitimate records and pad each to the cap.
    const compact = unwrap(seal(Array(63).fill(1)));
    const records = [definition, compact, references];
    const transports = records.map((record) => {
      const json = JSON.stringify(record);
      return json + " ".repeat(CAP - Buffer.byteLength(json, "utf8"));
    });
    expect(transports.reduce((sum, input) => sum + Buffer.byteLength(input, "utf8"), 0)).toBe(
      786_432,
    );
    measure(
      "three maximum serialized records",
      { bytesPerRecord: CAP, combinedBytes: 786_432 },
      () => transports.map((input) => unwrap(decodeSerializedRecord(input))),
      ([def, ev, refs]) => expect(evaluate(def, ev, refs).outcome).toBe("pass"),
    );
    for (const input of transports)
      expect(decodeSerializedRecord(`${input} `)).toEqual({
        ok: false,
        diagnostics: [{ path: "$", code: "INPUT_TOO_LARGE" }],
      });
  }, 30000);
});
