import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  decodeSerializedRecord,
  evaluate,
  inspectEvidenceCoverage,
  parseEvaluationResult,
  projectPublicResult,
} from "../src/index";

const states = ["pass", "fail", "inconclusive", "evaluation_error"] as const;
type State = (typeof states)[number];
type Operator = "all" | "any";
const artifactDigest = `sha256:${"c".repeat(64)}`;
const privatePrefix = "AYI27_PRIVATE_";
const rejected = { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" };

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("Invalid independent AY-I27 fixture");
  return result.value;
}

// Separate oracle: use set membership and specification precedence, not the
// engine's recursive fold or its binary truth-table fixture.
function decide(operator: Operator, children: readonly State[]): State {
  const priority: readonly State[] =
    operator === "all"
      ? ["fail", "evaluation_error", "inconclusive", "pass"]
      : ["pass", "evaluation_error", "inconclusive", "fail"];
  const outcome = priority.find((state) => children.includes(state));
  if (!outcome) throw new Error("Empty oracle expression");
  return outcome;
}

// ECMAScript's property-list JSON serializer, not Assay's canonicalizer.
function bytes(value: unknown): string {
  const names = new Set<string>();
  JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const name of Object.keys(item)) names.add(name);
    }
    return item;
  });
  return JSON.stringify(value, [...names].sort());
}

function digest(domain: "definition" | "reference" | "evidence", value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`assay:${domain}:v4\n${bytes(value)}`)
    .digest("hex")}`;
}

function review(variant: number, visibility: "public" | "restricted" = "public") {
  const id = visibility === "restricted" ? `${privatePrefix}review` : "review";
  const criterion = {
    id,
    kind: "qualitative_review",
    mode: "advisory",
    visibility,
    parameters: { reviewPolicyId: "design", reviewPolicyVersion: "rev1" },
  };
  const observation = {
    criterionId: id,
    evidenceRef: `${privatePrefix}review-ref`,
    kind: "qualitative_review",
    completeness: variant === 2 ? "truncated" : "complete",
    origin: { kind: "artifact", artifactDigest, sourceRef: `${privatePrefix}origin` },
    ...criterion.parameters,
    reviewer:
      variant % 2 === 0
        ? { kind: "human", reviewerId: `${privatePrefix}human`, reviewerVersion: "rev1" }
        : {
            kind: "model",
            providerId: `${privatePrefix}provider`,
            modelId: `${privatePrefix}model`,
            modelVersion: "rev1",
            promptId: `${privatePrefix}prompt`,
            promptVersion: "rev2",
          },
    uncertainty: ["low", "medium", "high", "unknown"][variant % 4],
    feedback: `${privatePrefix}feedback-${variant} café\n\t😀`,
    citations: [
      { artifactRef: `${privatePrefix}citation`, startByte: variant, endByte: variant + 1 },
      { artifactRef: "part", startByte: 2, endByte: 3 },
    ],
  };
  return { criterion, observation };
}

function numeric(id: string, state: State, restricted = false) {
  const expected = state === "evaluation_error" ? 1e308 : 5;
  const referenceDraft = {
    schemaVersion: 4,
    referenceId: `${privatePrefix}ref-${id}`,
    kind: "number",
    value: expected,
  };
  const reference = restricted
    ? { ...referenceDraft, referenceDigest: digest("reference", referenceDraft) }
    : undefined;
  if (reference) expect(unwrap(createReferenceRecord(referenceDraft))).toEqual(reference);
  return {
    criterion: {
      id,
      mode: "required",
      visibility: restricted ? "restricted" : "public",
      kind: "number_with_tolerance",
      parameters: {
        expected: reference
          ? {
              type: "reference",
              referenceId: reference.referenceId,
              referenceDigest: reference.referenceDigest,
            }
          : { type: "literal", value: expected },
        tolerance: { absolute: 0, relative: state === "evaluation_error" ? 2 : 0 },
      },
    },
    observation: {
      criterionId: id,
      evidenceRef: `${id}-fact`,
      kind: "number",
      value: state === "fail" ? 4 : 5,
      completeness: state === "inconclusive" ? "truncated" : "complete",
      origin: { kind: "independent", sourceRef: "fixture" },
    },
    reference,
  };
}

function authored<G>(criteria: readonly unknown[], groups: readonly G[]) {
  return {
    schemaVersion: 4,
    assessmentId: "expanded-conformance",
    revision: "rev1",
    policyVersion: "composed-required-v1",
    criteria,
    composition: { rootGroupId: "root", groups },
  };
}
const leaf = (id: string) => ({ kind: "criterion", id });
const child = (id: string) => ({ kind: "group", id });

function nestedFixture(values: readonly State[], variant: number, hidden = false) {
  const ops = ["all", "any"] as const;
  const root = ops[variant & 1];
  const left = ops[(variant >> 1) & 1];
  const right = ops[(variant >> 2) & 1];
  const ids = ["a", "b", "c", hidden ? `${privatePrefix}d` : "d"];
  const entries = values.map((state, i) => numeric(ids[i], state, hidden && i === 3));
  const qualitative = review(variant, hidden ? "restricted" : "public");
  // Vary group/child order independently of authored finding order.
  const groupId = hidden ? `${privatePrefix}group` : "right";
  const groups = [
    { id: "left", operator: left, children: [leaf(ids[1]), leaf(ids[0])] },
    { id: "root", operator: root, children: [child(groupId), child("left")] },
    { id: groupId, operator: right, children: [leaf(ids[2]), leaf(ids[3])] },
  ];
  const draft = authored(
    [...entries.map((entry) => entry.criterion), qualitative.criterion],
    groups,
  );
  const definition = unwrap(createAssessmentDefinition(draft));
  expect(definition.revisionDigest).toBe(digest("definition", draft));
  const observations = entries.map((entry) => entry.observation);
  const evidenceDraft = {
    schemaVersion: 4,
    artifactDigest,
    observations: variant === 0 ? observations : [...observations, qualitative.observation],
  };
  const lineage = {
    assessmentId: draft.assessmentId,
    revision: draft.revision,
    revisionDigest: definition.revisionDigest,
  };
  const evidence = unwrap(createEvidenceBundle(definition, evidenceDraft));
  expect(evidence.evidenceDigest).toBe(
    digest("evidence", { ...evidenceDraft, definition: lineage }),
  );
  const references = {
    schemaVersion: 4,
    definition: lineage,
    references: entries.flatMap((entry) => (entry.reference ? [entry.reference] : [])),
  };
  return {
    definition,
    evidence,
    references,
    draft,
    qualitative,
    root: decide(root, [decide(left, values.slice(0, 2)), decide(right, values.slice(2))]),
    ids,
  };
}

describe("AY-I27 independent expanded conformance", () => {
  it("replays 2048 deterministic four-leaf cases across all eight operator assignments", () => {
    for (let variant = 0; variant < 8; variant++) {
      for (let n = 0; n < 256; n++) {
        const values = [0, 2, 4, 6].map((shift) => states[(n >> shift) & 3]);
        const f = nestedFixture(values, variant, variant % 2 === 1);
        const result = evaluate(f.definition, f.evidence, f.references);
        if (!("findings" in result)) throw new Error("Expected complete generated result");
        expect(result.outcome).toBe(f.root);
        expect(result.findings.map((finding) => finding.criterionId)).toEqual([
          ...f.ids,
          f.qualitative.criterion.id,
        ]);
        expect(result.findings.map((finding) => finding.outcome)).toEqual([
          ...values.map((state) => (state === "evaluation_error" ? "error" : state)),
          "inconclusive",
        ]);
        expect(result.findings[4].reasonCode).toBe(
          variant === 0
            ? "EVIDENCE_MISSING"
            : variant === 2
              ? "EVIDENCE_TRUNCATED"
              : "REVIEW_REQUIRED",
        );
        expect(result.warnings).toEqual(["ADVISORY_UNRESOLVED"]);
        const coverage = unwrap(inspectEvidenceCoverage(f.definition, f.evidence));
        expect(coverage.missingRequired).toEqual([]);
        expect(coverage.incompleteRequired).toEqual(
          f.ids.filter((_id, i) => values[i] === "inconclusive"),
        );
        expect(parseEvaluationResult(result).ok).toBe(true);
        const publicResult = unwrap(projectPublicResult(f.definition, result));
        expect(publicResult.outcome).toBe(variant % 2 === 1 ? "withheld" : f.root);
        expect(publicResult.findings).toHaveLength(variant % 2 === 1 ? 3 : 5);
        expect(JSON.stringify(publicResult)).not.toContain(privatePrefix);
        expect(
          JSON.stringify(
            evaluate(
              structuredClone(f.definition),
              structuredClone(f.evidence),
              structuredClone(f.references),
            ),
          ),
        ).toBe(JSON.stringify(result));
      }
    }
  }, 30000);

  it("keeps public bytes fixed across hidden objective and review permutations", () => {
    const outputs = new Set<string>();
    for (const state of states) {
      for (let variant = 0; variant < 8; variant++) {
        const f = nestedFixture(["pass", "fail", "pass", state], variant, true);
        const result = evaluate(f.definition, f.evidence, f.references);
        if (!("findings" in result)) throw new Error("Expected complete result");
        expect(result.outcome).toBe(f.root);
        const view = unwrap(projectPublicResult(f.definition, result));
        const serialized = JSON.stringify(view);
        outputs.add(serialized);
        expect(serialized).not.toContain(privatePrefix);
        expect(view).toEqual({
          schemaVersion: 4,
          outcome: "withheld",
          findings: [
            { criterionId: "a", outcome: "pass", reason: "match" },
            { criterionId: "b", outcome: "fail", reason: "mismatch" },
            { criterionId: "c", outcome: "pass", reason: "match" },
          ],
        });
        expect(
          projectPublicResult(f.definition, {
            ...result,
            outcome: result.outcome === "pass" ? "fail" : "pass",
          }),
        ).toEqual(rejected);
        const fakeReview = { ...result.findings[4], outcome: "pass", reasonCode: "MATCH" };
        expect(
          projectPublicResult(f.definition, {
            ...result,
            findings: [...result.findings.slice(0, 4), fakeReview],
          }),
        ).toEqual(rejected);
      }
    }
    expect(outputs.size).toBe(1);
  });

  it("rejects independent malformed alternate and qualitative records with bounded redacted diagnostics", () => {
    const f = nestedFixture(["pass", "pass", "pass", "fail"], 1, true);
    expect(evaluate(f.definition, f.evidence, f.references).outcome).toBe("pass");
    const { evidenceDigest: _old, ...content } = f.evidence;
    const reviewInput = f.qualitative.observation;
    const alternate = content.observations[3];
    const cases = [
      [0, { ...content.observations[0], value: "wrong-kind" }],
      [3, { ...alternate, unit: "ms" }],
      [3, { ...alternate, kind: "text", value: "5" }],
      [4, { ...reviewInput, feedback: "\ud800" }],
      [4, { ...reviewInput, feedback: "é".repeat(2049) }],
      [4, { ...reviewInput, uncertainty: "certain" }],
      [4, { ...reviewInput, reviewer: { ...reviewInput.reviewer, trusted: true } }],
      [4, { ...reviewInput, reviewPolicyVersion: "rev2" }],
      [4, { ...reviewInput, citations: [reviewInput.citations[0], reviewInput.citations[0]] }],
      [4, { ...reviewInput, origin: { ...reviewInput.origin, runRef: "run" } }],
      [4, { ...reviewInput, [`${privatePrefix}unknown-key`]: { value: "x" } }],
      [4, { ...reviewInput, completeness: "truncated", citations: [] }],
    ] as const;
    for (const [index, mutation] of cases) {
      const changed = {
        ...content,
        observations: content.observations.map((o, i) => (i === index ? mutation : o)),
      };
      const sealed = { ...changed, evidenceDigest: digest("evidence", changed) };
      const response = evaluate(f.definition, sealed, f.references);
      expect(response.outcome).toBe("invalid_evidence");
      expect(response).not.toHaveProperty("findings");
      expect(JSON.stringify(response)).not.toContain(privatePrefix);
      const wrongReference = {
        ...f.references,
        references: f.references.references.map((r) => ({ ...r, value: 9 })),
      };
      expect(evaluate(f.definition, sealed, wrongReference).outcome).toBe("invalid_reference");
      expect(evaluate({ ...f.definition, schemaVersion: 3 }, sealed, wrongReference).outcome).toBe(
        "invalid_definition",
      );
    }
    for (const target of ["feedback", "reviewer", "citations"]) {
      // JSON duplicate names are rejected before the typed validator can lose them.
      const raw = `{"observations":[{"${target}":null,"${target}":"${privatePrefix}value"}]}`;
      expect(decodeSerializedRecord(raw)).toEqual({
        ok: false,
        diagnostics: [{ path: "$", code: "DUPLICATE_KEY" }],
      });
    }
    const graph = f.draft.composition.groups;
    for (const groups of [
      [...graph, { id: "unused", operator: "all", children: [leaf("a")] }],
      graph.map((g) => (g.id === "root" ? { ...g, children: [child("root")] } : g)),
      graph.map((g) => (g.id === "root" ? { ...g, children: [...g.children, child("left")] } : g)),
      graph.map((g) =>
        g.id === "left" ? { ...g, children: [leaf(f.qualitative.criterion.id)] } : g,
      ),
    ]) {
      const input = { ...f.draft, composition: { rootGroupId: "root", groups } };
      const response = evaluate(
        { ...input, revisionDigest: digest("definition", input) },
        f.evidence,
      );
      expect(response.outcome).toBe("invalid_definition");
      expect(JSON.stringify(response)).not.toContain(privatePrefix);
    }
  });
});
