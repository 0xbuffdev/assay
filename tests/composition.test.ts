import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AssessmentDefinitionDraft,
  type Criterion,
  type CriterionComposition,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  evaluate,
  type FindingOutcome,
  inspectEvidenceCoverage,
  projectPublicResult,
  type TechnicalOutcome,
  verifyAssessmentDefinition,
} from "../src/index";

const outcomes = ["pass", "fail", "inconclusive", "error"] as const;
const all = [
  ["pass", "fail", "inconclusive", "evaluation_error"],
  ["fail", "fail", "fail", "fail"],
  ["inconclusive", "fail", "inconclusive", "evaluation_error"],
  ["evaluation_error", "fail", "evaluation_error", "evaluation_error"],
] as const;
const any = [
  ["pass", "pass", "pass", "pass"],
  ["pass", "fail", "inconclusive", "evaluation_error"],
  ["pass", "inconclusive", "inconclusive", "evaluation_error"],
  ["pass", "evaluation_error", "evaluation_error", "evaluation_error"],
] as const;

function unwrap<T>(checked: { ok: true; value: T } | { ok: false }): T {
  if (!checked.ok) throw new Error("Invalid synthetic fixture");
  return checked.value;
}

function criterion(id: string, outcome: FindingOutcome = "pass"): Criterion {
  const error = outcome === "error";
  return {
    id,
    mode: "required",
    visibility: "public",
    kind: "number_with_tolerance",
    parameters: {
      expected: { type: "literal", value: error ? 1e308 : 42 },
      tolerance: { absolute: 0, relative: error ? 1e308 : 0 },
    },
  };
}

function observation(id: string, outcome: FindingOutcome = "pass") {
  return {
    criterionId: id,
    evidenceRef: `fact-${id}`,
    kind: "number",
    completeness: outcome === "inconclusive" ? "truncated" : "complete",
    value: outcome === "fail" ? 41 : 42,
  };
}

function leaf(id: string) {
  return { kind: "criterion", id } as const;
}

function group(id: string) {
  return { kind: "group", id } as const;
}

function draft(
  criteria: readonly Criterion[],
  composition: CriterionComposition,
): AssessmentDefinitionDraft {
  return {
    schemaVersion: 3,
    assessmentId: "composition",
    revision: "rev1",
    policyVersion: "composed-required-v1",
    criteria,
    composition,
  };
}

function flat(operator: "all" | "any", ids = ["first", "second"]): CriterionComposition {
  return { rootGroupId: "root", groups: [{ id: "root", operator, children: ids.map(leaf) }] };
}

function index(outcome: TechnicalOutcome): number {
  return outcome === "evaluation_error" ? 3 : outcomes.indexOf(outcome);
}

describe("AY-I23 composition", () => {
  it("matches both complete binary tables with all advisory outcomes", () => {
    for (const operator of ["all", "any"] as const) {
      const table = operator === "all" ? all : any;
      for (const [i, first] of outcomes.entries()) {
        for (const [j, second] of outcomes.entries()) {
          for (const advisory of outcomes) {
            const definition = unwrap(
              createAssessmentDefinition(
                draft(
                  [
                    criterion("first", first),
                    criterion("second", second),
                    { ...criterion("advice", advisory), mode: "advisory" },
                  ],
                  flat(operator),
                ),
              ),
            );
            const evidence = unwrap(
              createEvidenceBundle(definition, {
                schemaVersion: 3,
                observations: [
                  observation("first", first),
                  observation("second", second),
                  observation("advice", advisory),
                ],
              }),
            );
            const result = evaluate(definition, evidence);
            if (!("findings" in result)) throw new Error("Expected complete technical result");
            expect(result.outcome).toBe(table[i][j]);
            expect(result.findings.map((finding) => finding.outcome)).toEqual([
              first,
              second,
              advisory,
            ]);
            expect(projectPublicResult(definition, result)).toMatchObject({
              ok: true,
              value: { outcome: table[i][j] },
            });
            expect(evaluate(definition, evidence)).toEqual(result);
          }
        }
      }
    }
  });

  it("matches independent nested truth tables in either operator order", () => {
    for (const rootOperator of ["all", "any"] as const) {
      const childOperator = rootOperator === "all" ? "any" : "all";
      const rootTable = rootOperator === "all" ? all : any;
      const childTable = childOperator === "all" ? all : any;
      for (const [i, first] of outcomes.entries()) {
        for (const [j, second] of outcomes.entries()) {
          for (const [k, third] of outcomes.entries()) {
            const definition = unwrap(
              createAssessmentDefinition(
                draft(
                  [criterion("first", first), criterion("second", second), criterion("third", third)],
                  {
                    rootGroupId: "root",
                    groups: [
                      { id: "alternative", operator: childOperator, children: [leaf("second"), leaf("third")] },
                      { id: "root", operator: rootOperator, children: [leaf("first"), group("alternative")] },
                    ],
                  },
                ),
              ),
            );
            const evidence = unwrap(
              createEvidenceBundle(definition, {
                schemaVersion: 3,
                observations: [observation("first", first), observation("second", second), observation("third", third)],
              }),
            );
            expect(evaluate(definition, evidence).outcome).toBe(
              rootTable[i][index(childTable[j][k])],
            );
          }
        }
      }
    }
  });

  it("does not skip malformed alternatives or mistake absent evidence for a pass", () => {
    const definition = unwrap(
      createAssessmentDefinition(draft([criterion("first"), criterion("second")], flat("any"))),
    );
    const empty = unwrap(createEvidenceBundle(definition, { schemaVersion: 3, observations: [] }));
    expect(evaluate(definition, empty).outcome).toBe("inconclusive");
    const one = unwrap(
      createEvidenceBundle(definition, { schemaVersion: 3, observations: [observation("first")] }),
    );
    expect(evaluate(definition, one).outcome).toBe("pass");
    expect(inspectEvidenceCoverage(definition, one)).toMatchObject({
      ok: true,
      value: { missingRequired: ["second"] },
    });
    expect(
      createEvidenceBundle(definition, {
        schemaVersion: 3,
        observations: [observation("first"), { ...observation("second"), value: "invalid" }],
      }).ok,
    ).toBe(false);
  });

  it("rejects incomplete, ambiguous, cyclic and advisory membership", () => {
    const criteria = [
      criterion("first"),
      criterion("second"),
      { ...criterion("advice"), mode: "advisory" as const },
    ];
    const valid = flat("all");
    for (const composition of [
      flat("all", []),
      flat("all", ["first"]),
      flat("all", ["first", "first", "second"]),
      flat("all", ["first", "second", "advice"]),
      flat("all", ["first", "unknown"]),
      { ...valid, rootGroupId: "missing" },
      { ...valid, groups: [{ id: "first", operator: "all", children: [leaf("second")] }] },
      { ...valid, groups: [{ id: "root", operator: "all", children: [group("root")] }] },
      { ...valid, groups: [...valid.groups, { id: "unused", operator: "all", children: [leaf("first")] }] },
      { ...valid, groups: [
        { id: "root", operator: "all", children: [group("shared"), group("shared")] },
        { id: "shared", operator: "all", children: [leaf("first"), leaf("second")] },
      ] },
      { ...valid, groups: [...valid.groups, ...valid.groups] },
      { ...valid, groups: [{ id: "root", operator: "xor", children: [leaf("first"), leaf("second")] }] },
    ]) {
      expect(createAssessmentDefinition({ ...draft(criteria, valid), composition }).ok).toBe(false);
    }
  });

  it("enforces group depth, count and children limits", () => {
    function chain(count: number): CriterionComposition {
      return {
        rootGroupId: "g0",
        groups: Array.from({ length: count }, (_, i) => ({
          id: `g${i}`,
          operator: "all",
          children: [i + 1 === count ? leaf("first") : group(`g${i + 1}`)],
        })),
      };
    }
    expect(createAssessmentDefinition(draft([criterion("first")], chain(8))).ok).toBe(true);
    expect(createAssessmentDefinition(draft([criterion("first")], chain(9))).ok).toBe(false);
    const ids = Array.from({ length: 64 }, (_, i) => `c${i}`);
    const criteria = ids.map((id) => criterion(id));
    const maximum: CriterionComposition = {
      rootGroupId: "root",
      groups: [
        { id: "root", operator: "all", children: [leaf("c63"), ...ids.slice(0, 63).map((id) => group(`g-${id}`))] },
        ...ids.slice(0, 63).map((id) => ({ id: `g-${id}`, operator: "all" as const, children: [leaf(id)] })),
      ],
    };
    expect(createAssessmentDefinition(draft(criteria, maximum)).ok).toBe(true);
    expect(createAssessmentDefinition(draft(criteria, flat("all", [...ids, "c0"]))).ok).toBe(false);
    expect(createAssessmentDefinition({
      ...draft(criteria, maximum),
      composition: { ...maximum, groups: [...maximum.groups, { id: "extra", operator: "all", children: [leaf("c0")] }] },
    }).ok).toBe(false);
  });

  it("binds authored group ordering and rejects obsolete schema and policy IDs", () => {
    const authored = draft([criterion("first"), criterion("second")], flat("all"));
    const sealed = unwrap(createAssessmentDefinition(authored));
    const reordered = unwrap(createAssessmentDefinition({
      ...authored,
      composition: flat("all", ["second", "first"]),
    }));
    expect(sealed.revisionDigest).not.toBe(reordered.revisionDigest);
    const encoded = JSON.stringify(authored, (_key, value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const object = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
    });
    expect(sealed.revisionDigest).toBe(
      `sha256:${createHash("sha256").update(`assay:definition:v3\n${encoded}`, "utf8").digest("hex")}`,
    );
    expect(verifyAssessmentDefinition({ ...sealed, composition: flat("any") }).ok).toBe(false);
    for (const schemaVersion of [1, 2, 4]) {
      expect(createAssessmentDefinition({ ...authored, schemaVersion }).ok).toBe(false);
    }
    expect(createAssessmentDefinition({ ...authored, policyVersion: "all-required-v1" }).ok).toBe(false);
  });

  it("withholds the aggregate and rejects incoherent composed results", () => {
    const reference = unwrap(createReferenceRecord({
      schemaVersion: 3,
      referenceId: "private-canary",
      kind: "number",
      value: 42,
    }));
    const hidden = {
      ...criterion("hidden-canary"),
      visibility: "restricted",
      kind: "number_with_tolerance",
      parameters: {
        expected: { type: "reference", referenceId: reference.referenceId, referenceDigest: reference.referenceDigest },
        tolerance: { absolute: 0, relative: 0 },
      },
    } as const;
    const definition = unwrap(createAssessmentDefinition(draft([criterion("first"), hidden], flat("any", ["first", "hidden-canary"]))));
    const refs = {
      schemaVersion: 3,
      definition: { assessmentId: definition.assessmentId, revision: definition.revision, revisionDigest: definition.revisionDigest },
      references: [reference],
    };
    const projections = [];
    for (const outcome of ["pass", "fail", "inconclusive"] as const) {
      const evidence = unwrap(createEvidenceBundle(definition, {
        schemaVersion: 3,
        observations: [observation("first", "fail"), observation("hidden-canary", outcome)],
      }));
      const result = evaluate(definition, evidence, refs);
      if (!("findings" in result)) throw new Error("Expected complete result");
      const projection = projectPublicResult(definition, result);
      expect(projection).toMatchObject({ ok: true, value: { outcome: "withheld" } });
      expect(JSON.stringify(projection)).not.toContain("canary");
      projections.push(projection);
      expect(projectPublicResult(definition, { ...result, outcome: result.outcome === "pass" ? "fail" : "pass" }).ok).toBe(false);
    }
    expect(projections[0]).toEqual(projections[1]);
    expect(projections[1]).toEqual(projections[2]);
  });
});
