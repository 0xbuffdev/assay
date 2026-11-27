import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type AssessmentDefinition,
  CONTRACT_LIMITS,
  computeDefinitionDigest,
  createAssessmentDefinition,
  createReferenceRecord,
  evaluate,
  parseAssessmentDefinition,
  projectPublicResult,
  type ReferenceBundle,
  type ReferenceRecord,
  type ValidationResult,
  verifyAssessmentDefinition,
  verifyReferenceBundle,
} from "../src/index";
import { allComposition, sealEvidenceFixture } from "./fixtures/contracts";

const referenceDigest = "sha256:e28e007acf7ef464608360a68f53c40b2e949954d2dedff20448e68f52d0d18f";
const definitionDigest = "sha256:b0b4ed130a1ed38d5b306a7c43f10a512fbe8f2905b110ea781c4f3bcc8fd6cf";
const referenceBytes = '{"kind":"text","referenceId":"secret","schemaVersion":3,"value":"café\\n"}';
const definitionBytes =
  '{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"referenceDigest":"sha256:e28e007acf7ef464608360a68f53c40b2e949954d2dedff20448e68f52d0d18f","referenceId":"secret","type":"reference"}},"visibility":"restricted"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":3}';

function independent(domain: string, canonical: string): string {
  return `sha256:${createHash("sha256").update(`${domain}\n${canonical}`, "utf8").digest("hex")}`;
}

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  return result.value;
}

const referenceDraft = {
  schemaVersion: 3,
  referenceId: "secret",
  kind: "text",
  value: "café\n",
} as const;

function expected(record: ReferenceRecord) {
  return {
    type: "reference",
    referenceId: record.referenceId,
    referenceDigest: record.referenceDigest,
  } as const;
}

function textCriterion(record: ReferenceRecord, id = "output") {
  return {
    id,
    mode: "required",
    visibility: "restricted",
    kind: "exact_text",
    parameters: { expected: expected(record) },
  } as const;
}

function draft(criteria: readonly unknown[]) {
  return {
    schemaVersion: 3,
    assessmentId: "vector",
    revision: "rev1",
    policyVersion: "composed-required-v1",
    criteria,
    composition: allComposition(criteria),
  };
}

function bundle(definition: AssessmentDefinition, records: readonly ReferenceRecord[]) {
  return {
    schemaVersion: 3,
    definition: {
      assessmentId: definition.assessmentId,
      revision: definition.revision,
      revisionDigest: definition.revisionDigest,
    },
    references: records,
  } satisfies ReferenceBundle;
}

function fixture() {
  const record = unwrap(createReferenceRecord(referenceDraft));
  const definition = unwrap(createAssessmentDefinition(draft([textCriterion(record)])));
  return { record, definition, bundle: bundle(definition, [record]) };
}

describe("AY-I13 content-bound reference contracts", () => {
  it("matches independent canonical UTF-8 SHA-256 vectors for schema 3", () => {
    const f = fixture();
    expect(independent("assay:reference:v3", referenceBytes)).toBe(referenceDigest);
    expect(independent("assay:definition:v3", definitionBytes)).toBe(definitionDigest);
    expect(f.record.referenceDigest).toBe(referenceDigest);
    expect(f.definition.revisionDigest).toBe(definitionDigest);
    expect(verifyAssessmentDefinition(f.definition).ok).toBe(true);
    const verified = unwrap(verifyReferenceBundle(f.definition, f.bundle));
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.references)).toBe(true);
    expect(Object.isFrozen(verified.references[0])).toBe(true);
    expect(
      unwrap(
        createReferenceRecord({
          value: "café\n",
          kind: "text",
          referenceId: "secret",
          schemaVersion: 3,
        }),
      ),
    ).toEqual(f.record);
  });

  it("requires schema-2 reference digests and does not reinterpret schema 1", () => {
    const f = fixture();
    const unbound = {
      ...textCriterion(f.record),
      parameters: { expected: { type: "reference", referenceId: "secret" } },
    };
    expect(createAssessmentDefinition(draft([unbound])).ok).toBe(false);
    expect(
      createAssessmentDefinition({ ...draft([textCriterion(f.record)]), schemaVersion: 1 }).ok,
    ).toBe(false);
    expect(
      createAssessmentDefinition({ ...draft([textCriterion(f.record)]), schemaVersion: 2 }).ok,
    ).toBe(false);
    expect(createAssessmentDefinition({ ...draft([unbound]), schemaVersion: 1 }).ok).toBe(false);
    expect(verifyReferenceBundle({ ...f.definition, schemaVersion: 1 }, f.bundle)).toMatchObject({
      ok: false,
      domain: "invalid_definition",
    });
    expect(verifyReferenceBundle(f.definition, { ...f.bundle, schemaVersion: 1 }).ok).toBe(false);
    expect(createReferenceRecord({ ...referenceDraft, schemaVersion: 1 }).ok).toBe(false);
    expect(createReferenceRecord({ ...referenceDraft, referenceDigest }).ok).toBe(false);
    expect(parseAssessmentDefinition({ ...f.definition, schemaVersion: 1 }).ok).toBe(false);
  });

  it("binds reference content and IDs independently of caller claims", () => {
    const f = fixture();
    const changed = unwrap(createReferenceRecord({ ...referenceDraft, value: "changed" }));
    const renamed = unwrap(createReferenceRecord({ ...referenceDraft, referenceId: "other" }));
    for (const record of [{ ...f.record, value: "PRIVATE_CANARY" }, changed, renamed]) {
      const result = verifyReferenceBundle(f.definition, { ...f.bundle, references: [record] });
      expect(result).toMatchObject({ ok: false, domain: "invalid_reference" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    }
    const alteredDefinition = {
      ...f.definition,
      criteria: [textCriterion(changed)],
    };
    expect(verifyAssessmentDefinition(alteredDefinition)).toMatchObject({
      ok: false,
      diagnostics: [{ path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" }],
    });
    expect(unwrap(computeDefinitionDigest(draft([textCriterion(changed)])))).not.toBe(
      definitionDigest,
    );
    const wrongLineage = verifyReferenceBundle(f.definition, {
      ...f.bundle,
      definition: { ...f.bundle.definition, revision: "rev2" },
    });
    expect(wrongLineage).toMatchObject({ ok: false, domain: "invalid_reference" });

    const other = unwrap(createReferenceRecord({ ...referenceDraft, referenceId: "other" }));
    const swapped = {
      ...textCriterion(f.record),
      parameters: {
        expected: { ...expected(f.record), referenceDigest: other.referenceDigest },
      },
    };
    const wrongDefinition = unwrap(createAssessmentDefinition(draft([swapped])));
    expect(verifyReferenceBundle(wrongDefinition, bundle(wrongDefinition, [f.record])).ok).toBe(
      false,
    );

    const ownKeys = vi.fn(() => []);
    const hostileBundle = new Proxy({}, { ownKeys });
    expect(verifyReferenceBundle(alteredDefinition, hostileBundle).ok).toBe(false);
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it("rejects duplicates and unsolicited records but admits partial bundles", () => {
    const f = fixture();
    const duplicate = createAssessmentDefinition(
      draft([textCriterion(f.record), textCriterion(f.record, "other")]),
    );
    expect(duplicate.ok).toBe(false);
    const duplicateBundle = verifyReferenceBundle(f.definition, {
      ...f.bundle,
      references: [f.record, f.record],
    });
    expect(duplicateBundle).toMatchObject({ ok: false, domain: "invalid_reference" });
    const other = unwrap(createReferenceRecord({ ...referenceDraft, referenceId: "other" }));
    const unsolicited = verifyReferenceBundle(f.definition, {
      ...f.bundle,
      references: [f.record, other],
    });
    expect(unsolicited).toMatchObject({ ok: false, domain: "invalid_reference" });
    expect(verifyReferenceBundle(f.definition, { ...f.bundle, references: [] }).ok).toBe(true);

    // Omitting separately supplied material still makes comparison unavailable.
    const result = evaluate(
      f.definition,
      sealEvidenceFixture({
        schemaVersion: 3,
        definition: f.bundle.definition,
        observations: [
          {
            criterionId: "output",
            evidenceRef: "obs1",
            kind: "text",
            completeness: "complete",
            value: referenceDraft.value,
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      outcome: "inconclusive",
      findings: [{ outcome: "inconclusive", reasonCode: "REFERENCE_UNAVAILABLE" }],
    });
  });

  it("checks inferred kinds, exact units and set item types for sealed records", () => {
    const text = unwrap(createReferenceRecord(referenceDraft));
    const numericDraft = {
      schemaVersion: 3,
      referenceId: "quantity",
      kind: "number",
      value: 10,
    };
    const meters = unwrap(createReferenceRecord({ ...numericDraft, unit: "m" }));
    const unitless = unwrap(createReferenceRecord(numericDraft));
    const items = unwrap(
      createReferenceRecord({
        schemaVersion: 3,
        referenceId: "items",
        kind: "set",
        itemType: "number",
        value: [1, 2],
      }),
    );
    expect(meters.referenceDigest).toBe(
      "sha256:1e4890246c0eda1381302e0d56d458fc08d2883e806b411eec5572b24cd78a0b",
    );
    expect(items.referenceDigest).toBe(
      "sha256:eb8098fafa7f466e471989a3f2106d02b130766c3c27cee4692ba77b8ae587a8",
    );
    const base = { id: "check", mode: "required", visibility: "restricted" };
    function numeric(record: ReferenceRecord, unit?: string) {
      return {
        ...base,
        kind: "number_with_tolerance",
        parameters: {
          expected: expected(record),
          tolerance: { absolute: 0, relative: 0 },
          ...(unit === undefined ? {} : { unit }),
        },
      };
    }
    function set(record: ReferenceRecord, itemType: string) {
      return {
        ...base,
        kind: "set_equivalence",
        parameters: {
          expected: expected(record),
          itemType,
          order: "ignore",
          duplicates: "ignore",
        },
      };
    }
    const cases = [
      { record: text, criterion: numeric(text), valid: false },
      { record: meters, criterion: numeric(meters, "m"), valid: true },
      { record: meters, criterion: numeric(meters, "ft"), valid: false },
      { record: meters, criterion: numeric(meters), valid: false },
      { record: unitless, criterion: numeric(unitless, "m"), valid: false },
      { record: unitless, criterion: numeric(unitless), valid: true },
      { record: items, criterion: set(items, "number"), valid: true },
      { record: items, criterion: set(items, "string"), valid: false },
    ];
    for (const { record, criterion, valid } of cases) {
      const definition = unwrap(createAssessmentDefinition(draft([criterion])));
      const checked = verifyReferenceBundle(definition, bundle(definition, [record]));
      expect(checked.ok).toBe(valid);
      if (!valid) {
        expect(
          evaluate(definition, observed(definition, []), bundle(definition, [record])),
        ).toMatchObject({ outcome: "invalid_reference" });
      }
      if (!valid) {
        expect(checked).toMatchObject({
          domain: "invalid_reference",
          diagnostics: [{ path: "$.references[0]", code: "MISMATCHED_REFERENCE" }],
        });
      }
    }
  });

  it("keeps authored set order and unit absence part of reference identity", () => {
    const record = {
      schemaVersion: 3,
      referenceId: "set1",
      kind: "set",
      itemType: "number",
      value: [1, 2],
    };
    expect(unwrap(createReferenceRecord(record)).referenceDigest).not.toBe(
      unwrap(createReferenceRecord({ ...record, value: [2, 1] })).referenceDigest,
    );
    const number = { schemaVersion: 3, referenceId: "num", kind: "number", value: 1 };
    expect(unwrap(createReferenceRecord(number)).referenceDigest).not.toBe(
      unwrap(createReferenceRecord({ ...number, unit: "m" })).referenceDigest,
    );
  });

  it("rejects malformed values, accessors, restricted literals and oversized inputs", () => {
    const f = fixture();
    const getter = vi.fn(() => "PRIVATE_CANARY");
    const accessor = { ...referenceDraft };
    Object.defineProperty(accessor, "value", { enumerable: true, get: getter });
    const invalid = [
      accessor,
      { ...referenceDraft, value: "x".repeat(CONTRACT_LIMITS.maxStringLength + 1) },
      { ...referenceDraft, kind: "number", value: Infinity },
      { ...referenceDraft, kind: "number", value: "1" },
      { ...referenceDraft, kind: "number", value: 1, unit: null },
      { ...referenceDraft, kind: "text", unit: "m" },
      { ...referenceDraft, kind: "set", itemType: "boolean", value: [true, "false"] },
      { ...referenceDraft, kind: "set", itemType: "string", value: Array(129).fill("a") },
      {
        ...referenceDraft,
        kind: "set",
        itemType: "string",
        value: Array(17).fill("x".repeat(16384)),
      },
      { ...referenceDraft, PRIVATE_CANARY: 1 },
    ];
    for (const record of invalid) {
      const checked = createReferenceRecord(record);
      expect(checked.ok).toBe(false);
      expect(JSON.stringify(checked)).not.toContain("PRIVATE_CANARY");
    }
    expect(getter).not.toHaveBeenCalled();
    const tooMany = verifyReferenceBundle(f.definition, {
      ...f.bundle,
      references: Array(CONTRACT_LIMITS.maxCriteria + 1).fill(f.record),
    });
    expect(tooMany.ok).toBe(false);
    const restrictedLiteral = createAssessmentDefinition(
      draft([
        {
          ...textCriterion(f.record),
          parameters: { expected: { type: "literal", value: "PRIVATE_CANARY" } },
        },
      ]),
    );
    expect(restrictedLiteral.ok).toBe(false);
  });
});

function observed(definition: AssessmentDefinition, observations: readonly unknown[]) {
  return sealEvidenceFixture({
    schemaVersion: 3,
    definition: bundle(definition, []).definition,
    observations,
  });
}

function observation(id: string, data: Record<string, unknown>) {
  return { criterionId: id, evidenceRef: `obs-${id}`, completeness: "complete", ...data };
}

describe("AY-I14 protected reference evaluation", () => {
  it("compares exact text, rejects tampering, and preserves an opaque public view", () => {
    const record = unwrap(
      createReferenceRecord({ ...referenceDraft, value: "PRIVATE_EXPECTED_CANARY" }),
    );
    const definition = unwrap(createAssessmentDefinition(draft([textCriterion(record)])));
    const refs = bundle(definition, [record]);
    const correct = observed(definition, [
      observation("output", { kind: "text", value: "PRIVATE_EXPECTED_CANARY" }),
    ]);
    const incorrect = observed(definition, [
      observation("output", { kind: "text", value: "PRIVATE_OBSERVED_CANARY" }),
    ]);
    const pass = evaluate(definition, correct, refs);
    const fail = evaluate(definition, incorrect, refs);
    expect(pass).toMatchObject({
      outcome: "pass",
      findings: [{ outcome: "pass", reasonCode: "MATCH" }],
    });
    expect(fail).toMatchObject({
      outcome: "fail",
      findings: [{ outcome: "fail", reasonCode: "VALUE_MISMATCH" }],
    });
    expect(evaluate(definition, correct, refs)).toEqual(pass);
    const unavailable = evaluate(definition, correct, bundle(definition, []));
    expect(unavailable).toMatchObject({
      outcome: "inconclusive",
      findings: [{ reasonCode: "REFERENCE_UNAVAILABLE" }],
    });
    expect(evaluate(definition, correct)).toEqual(unavailable);
    const projected = projectPublicResult(definition, pass);
    expect(projected).toEqual({
      ok: true,
      value: { schemaVersion: 3, outcome: "withheld", findings: [] },
    });
    expect(projectPublicResult(definition, fail)).toEqual(projected);
    expect(projectPublicResult(definition, unavailable)).toEqual(projected);
    for (const result of [pass, fail, unavailable, projected]) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("PRIVATE_EXPECTED_CANARY");
      expect(serialized).not.toContain("PRIVATE_OBSERVED_CANARY");
      expect(serialized).not.toContain(record.referenceDigest);
      expect(serialized).not.toContain(record.referenceId);
    }

    const other = unwrap(createReferenceRecord({ ...referenceDraft, referenceId: "other" }));
    const changed = unwrap(createReferenceRecord({ ...referenceDraft, value: "changed" }));
    for (const invalid of [
      null,
      { ...refs, schemaVersion: 1 },
      { ...refs, definition: { ...refs.definition, revision: "rev2" } },
      { ...refs, references: [{ ...record, value: "PRIVATE_TAMPER_CANARY" }] },
      { ...refs, references: [changed] },
      { ...refs, references: [record, record] },
      { ...refs, references: [record, other] },
    ]) {
      const rejected = evaluate(definition, observed(definition, []), invalid);
      expect(rejected).toMatchObject({ outcome: "invalid_reference" });
      expect(Object.keys(rejected).sort()).toEqual(["diagnostics", "outcome"]);
      expect(JSON.stringify(rejected)).not.toContain("CANARY");
      expect(projectPublicResult(definition, rejected)).toEqual({
        ok: false,
        reasonCode: "PUBLIC_PROJECTION_REJECTED",
      });
    }
    const ownKeys = vi.fn(() => []);
    const hostile = new Proxy({}, { ownKeys });
    const altered = { ...definition, revision: "rev2" };
    expect(evaluate(altered, hostile, hostile).outcome).toBe("invalid_definition");
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it("reuses normalization, numeric tolerance and set multiplicity for references", () => {
    const text = unwrap(createReferenceRecord({ ...referenceDraft, value: " CAFÉ\r\n" }));
    const number = unwrap(
      createReferenceRecord({
        schemaVersion: 3,
        referenceId: "number",
        kind: "number",
        value: 100,
        unit: "m",
      }),
    );
    const set = unwrap(
      createReferenceRecord({
        schemaVersion: 3,
        referenceId: "set",
        kind: "set",
        itemType: "number",
        value: [1, 2, 1],
      }),
    );
    const definition = unwrap(
      createAssessmentDefinition(
        draft([
          {
            ...textCriterion(text, "text"),
            visibility: "public",
            kind: "normalized_text",
            parameters: {
              expected: expected(text),
              normalization: {
                lineEndings: "lf",
                unicode: "NFC",
                case: "fold",
                whitespace: "collapse",
                trim: "both",
              },
            },
          },
          {
            ...textCriterion(number, "number"),
            kind: "number_with_tolerance",
            parameters: {
              expected: expected(number),
              unit: "m",
              tolerance: { absolute: 1, relative: 0.02 },
            },
          },
          {
            ...textCriterion(set, "set"),
            kind: "set_equivalence",
            parameters: {
              expected: expected(set),
              itemType: "number",
              order: "ignore",
              duplicates: "respect",
            },
          },
        ]),
      ),
    );
    const refs = bundle(definition, [set, number, text]);
    const textObs = observation("text", { kind: "text", value: "cafe\u0301" });
    const numObs = observation("number", { kind: "number", value: 102, unit: "m" });
    const setObs = observation("set", { kind: "set", itemType: "number", items: [2, 1, 1] });
    const evidence = observed(definition, [textObs, numObs, setObs]);
    const pass = evaluate(definition, evidence, refs);
    expect(pass).toMatchObject({
      outcome: "pass",
      findings: [{ outcome: "pass" }, { outcome: "pass" }, { outcome: "pass" }],
    });
    expect(evaluate(definition, evidence, bundle(definition, [text, number, set]))).toEqual(pass);
    const wrong = observed(definition, [
      { ...textObs, value: "different" },
      { ...numObs, value: 103 },
      { ...setObs, items: [1, 2] },
    ]);
    expect(evaluate(definition, wrong, refs)).toMatchObject({
      outcome: "fail",
      findings: [{ outcome: "fail" }, { outcome: "fail" }, { outcome: "fail" }],
    });
    expect(evaluate(definition, evidence, bundle(definition, [text]))).toMatchObject({
      outcome: "inconclusive",
      findings: [
        { outcome: "pass" },
        { reasonCode: "REFERENCE_UNAVAILABLE" },
        { reasonCode: "REFERENCE_UNAVAILABLE" },
      ],
    });
    expect(evaluate(definition, wrong, bundle(definition, [text])).outcome).toBe("fail");
    expect(
      evaluate(definition, observed(definition, [textObs, { ...numObs, unit: "ft" }]), refs)
        .outcome,
    ).toBe("invalid_evidence");
    expect(
      evaluate(
        definition,
        observed(definition, [textObs, { ...numObs, completeness: "truncated" }]),
        refs,
      ),
    ).toMatchObject({
      outcome: "inconclusive",
      findings: [
        { outcome: "pass" },
        { reasonCode: "EVIDENCE_TRUNCATED" },
        { reasonCode: "EVIDENCE_MISSING" },
      ],
    });
  });

  it("handles zero, empty expected values, and numeric overflow without truthiness checks", () => {
    for (const [value, actual, relative, outcome] of [
      [0, 0, 0, "pass"],
      [Number.MAX_VALUE, 0, 2, "evaluation_error"],
      [Number.MAX_VALUE, -Number.MAX_VALUE, 0, "fail"],
    ] as const) {
      const record = unwrap(
        createReferenceRecord({ schemaVersion: 3, referenceId: "num", kind: "number", value }),
      );
      const definition = unwrap(
        createAssessmentDefinition(
          draft([
            {
              ...textCriterion(record),
              kind: "number_with_tolerance",
              parameters: { expected: expected(record), tolerance: { absolute: 0, relative } },
            },
          ]),
        ),
      );
      expect(
        evaluate(
          definition,
          observed(definition, [observation("output", { kind: "number", value: actual })]),
          bundle(definition, [record]),
        ).outcome,
      ).toBe(outcome);
    }
    const record = unwrap(createReferenceRecord({ ...referenceDraft, value: "" }));
    const definition = unwrap(createAssessmentDefinition(draft([textCriterion(record)])));
    expect(
      evaluate(
        definition,
        observed(definition, [observation("output", { kind: "text", value: "" })]),
        bundle(definition, [record]),
      ).outcome,
    ).toBe("pass");
  });

  it("rejects legacy ID-only references and definitions rather than reinterpreting them", () => {
    const f = fixture();
    const legacy = {
      ...draft([
        {
          ...textCriterion(f.record),
          parameters: { expected: { type: "reference", referenceId: f.record.referenceId } },
        },
      ]),
      schemaVersion: 1,
      revisionDigest: definitionDigest,
    };
    expect(verifyAssessmentDefinition(legacy).ok).toBe(false);
    expect(evaluate(legacy, observed(f.definition, []), f.bundle).outcome).toBe(
      "invalid_definition",
    );
  });
});
