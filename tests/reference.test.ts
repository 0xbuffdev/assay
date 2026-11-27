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
  type ReferenceBundle,
  type ReferenceRecord,
  type ValidationResult,
  verifyAssessmentDefinition,
  verifyReferenceBundle,
} from "../src/index";

const referenceDigest = "sha256:b76df28194a4dc2b9afda31ff4dd8061e358f17bfd2a41c7ce5b7ad80046ecf5";
const definitionDigest = "sha256:a5105a469d8dec865417760e3516f52f5d0566f35bdeaa16803de7cf4c8e80a0";
const referenceBytes = '{"kind":"text","referenceId":"secret","schemaVersion":2,"value":"café\\n"}';
const definitionBytes =
  '{"assessmentId":"vector","criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"referenceDigest":"sha256:b76df28194a4dc2b9afda31ff4dd8061e358f17bfd2a41c7ce5b7ad80046ecf5","referenceId":"secret","type":"reference"}},"visibility":"restricted"}],"policyVersion":"policy1","revision":"rev1","schemaVersion":2}';

function independent(domain: string, canonical: string): string {
  return `sha256:${createHash("sha256").update(`${domain}\n${canonical}`, "utf8").digest("hex")}`;
}

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  return result.value;
}

const referenceDraft = {
  schemaVersion: 2,
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
    schemaVersion: 2,
    assessmentId: "vector",
    revision: "rev1",
    policyVersion: "policy1",
    criteria,
  };
}

function bundle(definition: AssessmentDefinition, records: readonly ReferenceRecord[]) {
  return {
    schemaVersion: 2,
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
  it("matches independent canonical UTF-8 SHA-256 vectors for schema 2", () => {
    const f = fixture();
    expect(independent("assay:reference:v2", referenceBytes)).toBe(referenceDigest);
    expect(independent("assay:definition:v2", definitionBytes)).toBe(definitionDigest);
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
          schemaVersion: 2,
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
      createAssessmentDefinition({ ...draft([textCriterion(f.record)]), schemaVersion: 3 }).ok,
    ).toBe(false);
    const legacy = unwrap(createAssessmentDefinition({ ...draft([unbound]), schemaVersion: 1 }));
    expect(verifyAssessmentDefinition(legacy).ok).toBe(true);
    expect(verifyReferenceBundle(legacy, f.bundle)).toMatchObject({
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

    // Validating separately supplied material does not make comparison available.
    const result = evaluate(f.definition, {
      schemaVersion: 1,
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
    });
    expect(result).toMatchObject({
      outcome: "inconclusive",
      findings: [{ outcome: "inconclusive", reasonCode: "REFERENCE_UNAVAILABLE" }],
    });
  });

  it("checks inferred kinds, exact units and set item types for sealed records", () => {
    const text = unwrap(createReferenceRecord(referenceDraft));
    const numericDraft = {
      schemaVersion: 2,
      referenceId: "quantity",
      kind: "number",
      value: 10,
    };
    const meters = unwrap(createReferenceRecord({ ...numericDraft, unit: "m" }));
    const unitless = unwrap(createReferenceRecord(numericDraft));
    const items = unwrap(
      createReferenceRecord({
        schemaVersion: 2,
        referenceId: "items",
        kind: "set",
        itemType: "number",
        value: [1, 2],
      }),
    );
    expect(meters.referenceDigest).toBe(
      "sha256:9d9dd9e71c2daf11f25122ef06f982ca2fc3f30a5b02e83f7a3460996e133076",
    );
    expect(items.referenceDigest).toBe(
      "sha256:1ea024bc6ce68a3e7e55a0b29f1a95dbb7f56228b3d736634fdde1a23165373a",
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
        expect(checked).toMatchObject({
          domain: "invalid_reference",
          diagnostics: [{ path: "$.references[0]", code: "MISMATCHED_REFERENCE" }],
        });
      }
    }
  });

  it("keeps authored set order and unit absence part of reference identity", () => {
    const record = {
      schemaVersion: 2,
      referenceId: "set1",
      kind: "set",
      itemType: "number",
      value: [1, 2],
    };
    expect(unwrap(createReferenceRecord(record)).referenceDigest).not.toBe(
      unwrap(createReferenceRecord({ ...record, value: [2, 1] })).referenceDigest,
    );
    const number = { schemaVersion: 2, referenceId: "num", kind: "number", value: 1 };
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
