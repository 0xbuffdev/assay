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
  parseEvaluationResult,
  projectPublicResult,
  type TechnicalOutcome,
  verifyAssessmentDefinition,
} from "../src/index";
import { referenceOf, sealEvidenceFixture } from "./fixtures/contracts";

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
                  [
                    criterion("first", first),
                    criterion("second", second),
                    criterion("third", third),
                  ],
                  {
                    rootGroupId: "root",
                    groups: [
                      {
                        id: "alternative",
                        operator: childOperator,
                        children: [leaf("second"), leaf("third")],
                      },
                      {
                        id: "root",
                        operator: rootOperator,
                        children: [leaf("first"), group("alternative")],
                      },
                    ],
                  },
                ),
              ),
            );
            const evidence = unwrap(
              createEvidenceBundle(definition, {
                schemaVersion: 3,
                observations: [
                  observation("first", first),
                  observation("second", second),
                  observation("third", third),
                ],
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

  it("rejects malformed nondecisive and advisory inputs at evaluation before comparison", () => {
    const reference = unwrap(
      createReferenceRecord({
        schemaVersion: 3,
        referenceId: "alternative-reference",
        kind: "number",
        value: 42,
      }),
    );
    const alternative: Criterion = {
      id: "second",
      mode: "required",
      visibility: "public",
      kind: "number_with_tolerance",
      parameters: {
        expected: {
          type: "reference",
          referenceId: reference.referenceId,
          referenceDigest: reference.referenceDigest,
        },
        tolerance: { absolute: 0, relative: 0 },
      },
    };
    const definition = unwrap(
      createAssessmentDefinition(
        draft(
          [criterion("first"), alternative, { ...criterion("advice"), mode: "advisory" }],
          flat("any"),
        ),
      ),
    );
    const valid = unwrap(
      createEvidenceBundle(definition, { schemaVersion: 3, observations: [observation("first")] }),
    );
    const references = {
      schemaVersion: 3,
      definition: referenceOf(definition),
      references: [reference],
    };
    expect(evaluate(definition, valid, references).outcome).toBe("pass");
    const invalidReferences = {
      ...references,
      references: [{ ...reference, value: 43 }],
    };
    expect(evaluate(definition, valid, invalidReferences)).toMatchObject({
      outcome: "invalid_reference",
    });
    for (const malformed of [
      { ...observation("second"), value: "invalid" },
      { ...observation("second"), kind: "text", value: "42" },
      { ...observation("second"), unit: "ms" },
      { ...observation("advice"), value: "invalid" },
    ]) {
      // Seal the malformed bytes independently, not through the validating constructor.
      const evidence = sealEvidenceFixture({
        ...valid,
        observations: [observation("first"), malformed],
      });
      const rejected = evaluate(definition, evidence, references);
      expect(rejected.outcome).toBe("invalid_evidence");
      expect(rejected).not.toHaveProperty("findings");
      expect(evaluate(definition, evidence, invalidReferences).outcome).toBe("invalid_reference");
      expect(
        evaluate({ ...definition, policyVersion: "all-required-v1" }, evidence, invalidReferences)
          .outcome,
      ).toBe("invalid_definition");
    }
  });

  it("requires composition and rejects unknown keys at every group-tree level", () => {
    const authored = draft([criterion("first"), criterion("second")], flat("any"));
    const { composition, ...omitted } = authored;
    expect(createAssessmentDefinition(omitted)).toMatchObject({
      ok: false,
      domain: "invalid_definition",
      diagnostics: [{ path: "$.composition", code: "MISSING_FIELD" }],
    });
    const [root] = composition.groups;
    const dangling = { ...root, children: [leaf("first"), leaf("second"), group("absent")] };
    expect(
      createAssessmentDefinition({ ...authored, composition: { ...composition, groups: [dangling] } })
        .ok,
    ).toBe(false);
    const mutations = [
      { ...composition, extra: "private-canary" },
      { ...composition, groups: [{ ...root, extra: "private-canary" }] },
      {
        ...composition,
        groups: [{ ...root, children: [{ ...leaf("first"), extra: "private-canary" }, leaf("second")] }],
      },
    ];
    for (const invalid of mutations) {
      const rejected = createAssessmentDefinition({ ...authored, composition: invalid });
      expect(rejected).toMatchObject({
        ok: false,
        domain: "invalid_definition",
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "UNEXPECTED_FIELD" })]),
      });
      expect(JSON.stringify(rejected)).not.toContain("private-canary");
    }
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
      {
        ...valid,
        groups: [...valid.groups, { id: "unused", operator: "all", children: [leaf("first")] }],
      },
      {
        ...valid,
        groups: [
          { id: "root", operator: "all", children: [group("shared"), group("shared")] },
          { id: "shared", operator: "all", children: [leaf("first"), leaf("second")] },
        ],
      },
      { ...valid, groups: [...valid.groups, ...valid.groups] },
      {
        ...valid,
        groups: [{ id: "root", operator: "xor", children: [leaf("first"), leaf("second")] }],
      },
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
        {
          id: "root",
          operator: "all",
          children: [leaf("c63"), ...ids.slice(0, 63).map((id) => group(`g-${id}`))],
        },
        ...ids
          .slice(0, 63)
          .map((id) => ({ id: `g-${id}`, operator: "all" as const, children: [leaf(id)] })),
      ],
    };
    expect(createAssessmentDefinition(draft(criteria, maximum)).ok).toBe(true);
    const overEdges = {
      ...maximum,
      groups: maximum.groups.map((entry) =>
        entry.id === "g-c0" ? { ...entry, children: [leaf("c0"), leaf("c0")] } : entry,
      ),
    };
    expect(createAssessmentDefinition(draft(criteria, overEdges))).toEqual({
      ok: false,
      domain: "invalid_definition",
      diagnostics: [{ path: "$.composition", code: "TOO_MANY_ITEMS" }],
    });
    expect(createAssessmentDefinition(draft(criteria, flat("all", [...ids, "c0"]))).ok).toBe(false);
    expect(
      createAssessmentDefinition({
        ...draft(criteria, maximum),
        composition: {
          ...maximum,
          groups: [...maximum.groups, { id: "extra", operator: "all", children: [leaf("c0")] }],
        },
      }).ok,
    ).toBe(false);
  });

  it("binds authored group ordering and rejects obsolete schema and policy IDs", () => {
    const authored = draft([criterion("first"), criterion("second")], flat("all"));
    const sealed = unwrap(createAssessmentDefinition(authored));
    const reordered = unwrap(
      createAssessmentDefinition({
        ...authored,
        composition: flat("all", ["second", "first"]),
      }),
    );
    expect(sealed.revisionDigest).not.toBe(reordered.revisionDigest);
    const encoded = JSON.stringify(authored, (_key, value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const object = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object)
          .sort()
          .map((key) => [key, object[key]]),
      );
    });
    expect(sealed.revisionDigest).toBe(
      `sha256:${createHash("sha256").update(`assay:definition:v3\n${encoded}`, "utf8").digest("hex")}`,
    );
    expect(verifyAssessmentDefinition({ ...sealed, composition: flat("any") }).ok).toBe(false);
    for (const schemaVersion of [1, 2, 4]) {
      expect(createAssessmentDefinition({ ...authored, schemaVersion }).ok).toBe(false);
    }
    expect(createAssessmentDefinition({ ...authored, policyVersion: "all-required-v1" }).ok).toBe(
      false,
    );
  });

  it("withholds every hidden any-branch outcome and rejects forged roots", () => {
    const normal = unwrap(
      createReferenceRecord({
        schemaVersion: 3,
        referenceId: "private-canary",
        kind: "number",
        value: 42,
      }),
    );
    const overflow = unwrap(
      createReferenceRecord({
        schemaVersion: 3,
        referenceId: "private-canary",
        kind: "number",
        value: 1e308,
      }),
    );
    const composition: CriterionComposition = {
      rootGroupId: "group-canary",
      groups: [
        {
          id: "group-canary",
          operator: "any",
          children: [leaf("first"), leaf("hidden-canary")],
        },
      ],
    };
    const cases = [
      { reference: normal, observed: observation("hidden-canary"), reason: "MATCH", leaf: "pass" },
      {
        reference: normal,
        observed: { ...observation("hidden-canary"), value: 200 },
        reason: "VALUE_MISMATCH",
        leaf: "fail",
      },
      {
        reference: normal,
        observed: observation("hidden-canary", "inconclusive"),
        reason: "EVIDENCE_TRUNCATED",
        leaf: "inconclusive",
      },
      { reference: normal, observed: null, reason: "EVIDENCE_MISSING", leaf: "inconclusive" },
      {
        reference: normal,
        observed: observation("hidden-canary"),
        omitReference: true,
        reason: "REFERENCE_UNAVAILABLE",
        leaf: "inconclusive",
      },
      {
        reference: overflow,
        observed: observation("hidden-canary"),
        reason: "NUMERIC_OVERFLOW",
        leaf: "error",
      },
    ] as const;
    for (const publicOutcome of ["pass", "fail"] as const) {
      const projections: string[] = [];
      for (const fixture of cases) {
        const hidden: Criterion = {
          id: "hidden-canary",
          mode: "required",
          visibility: "restricted",
          kind: "number_with_tolerance",
          parameters: {
            expected: {
              type: "reference",
              referenceId: fixture.reference.referenceId,
              referenceDigest: fixture.reference.referenceDigest,
            },
            tolerance: { absolute: 0, relative: 2 },
          },
        };
        const definition = unwrap(
          createAssessmentDefinition(draft([criterion("first"), hidden], composition)),
        );
        const refs = {
          schemaVersion: 3,
          definition: referenceOf(definition),
          references: "omitReference" in fixture ? [] : [fixture.reference],
        };
        const evidence = unwrap(
          createEvidenceBundle(definition, {
            schemaVersion: 3,
            observations: [
              observation("first", publicOutcome),
              ...(fixture.observed === null ? [] : [fixture.observed]),
            ],
          }),
        );
        const result = evaluate(definition, evidence, refs);
        if (!("findings" in result)) throw new Error("Expected complete result");
        const expectedRoot =
          publicOutcome === "pass"
            ? "pass"
            : fixture.leaf === "error"
              ? "evaluation_error"
              : fixture.leaf;
        expect(result.outcome).toBe(expectedRoot);
        expect(result.findings).toMatchObject([
          { criterionId: "first", outcome: publicOutcome },
          { criterionId: "hidden-canary", outcome: fixture.leaf, reasonCode: fixture.reason },
        ]);
        const projection = projectPublicResult(definition, result);
        expect(projection).toEqual({
          ok: true,
          value: {
            schemaVersion: 3,
            outcome: "withheld",
            findings: [
              {
                criterionId: "first",
                outcome: publicOutcome,
                reason: publicOutcome === "pass" ? "match" : "mismatch",
              },
            ],
          },
        });
        const bytes = JSON.stringify(projection);
        expect(bytes).not.toContain("canary");
        projections.push(bytes);
        const rejected = { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" };
        expect(
          projectPublicResult(definition, {
            ...result,
            outcome: result.outcome === "pass" ? "fail" : "pass",
          }),
        ).toEqual(rejected);
        const obsolete = { ...result, policyVersion: "all-required-v1" };
        expect(parseEvaluationResult(result).ok).toBe(true);
        expect(parseEvaluationResult(obsolete).ok).toBe(false);
        expect(projectPublicResult(definition, obsolete)).toEqual(rejected);
      }
      expect(new Set(projections).size).toBe(1);
    }
  });
});
