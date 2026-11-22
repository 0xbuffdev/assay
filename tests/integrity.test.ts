import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ASSAY_DEFINITION_DIGEST_VERSION,
  collectVerifiedObservations,
  computeDefinitionDigest,
  createAssessmentDefinition,
  evaluate,
  evaluateVerified,
  parseAssessmentDefinitionDraft,
  verifyAssessmentDefinition,
} from "../src/index";

const vector = {
  schemaVersion: 1,
  assessmentId: "vector",
  revision: "rev1",
  policyVersion: "policy1",
  criteria: [
    {
      id: "output",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "café\n" } },
    },
  ],
};

const expected = "sha256:e6382f984b711c58df762bcff7eba872246638a30a60ab07d807f6b7a9e35e8b";
const canonical = '{"assessmentId":"vector","criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\\n"}},"visibility":"public"}],"policyVersion":"policy1","revision":"rev1","schemaVersion":1}';

function seal(input: unknown) {
  const result = createAssessmentDefinition(input);
  if (!result.ok) throw new Error("Expected valid content-bound draft");
  return result.value;
}
function observed(revisionDigest: string, value = "café\n") {
  return {
    schemaVersion: 1,
    definition: { assessmentId: "vector", revision: "rev1", revisionDigest },
    observations: [
      {
        criterionId: "output",
        kind: "text",
        evidenceRef: "obs1",
        completeness: "complete",
        value,
      },
    ],
  };
}

describe("AY-I06 versioned canonical definition integrity", () => {
  it("matches a fixed independent SHA-256 golden vector including UTF-8 and newline", () => {
    expect(ASSAY_DEFINITION_DIGEST_VERSION).toBe("v1");
    const reference = "sha256:" + createHash("sha256")
      .update("assay:definition:v1\n" + canonical, "utf8")
      .digest("hex");
    expect(reference).toBe(expected);
    const calculated = computeDefinitionDigest(vector);
    expect(calculated).toEqual({ ok: true, value: expected });
    const definition = seal(vector);
    expect(definition.revisionDigest).toBe(expected);
    expect(verifyAssessmentDefinition(definition)).toMatchObject({ ok: true });
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.criteria)).toBe(true);
  });

  it("canonicalizes object property insertion order but respects authored array order", () => {
    const shuffled = {
      criteria: [{
        parameters: { expected: { value: "café\n", type: "literal" } },
        kind: "exact_text",
        visibility: "public",
        mode: "required",
        id: "output",
      }],
      policyVersion: "policy1",
      revision: "rev1",
      assessmentId: "vector",
      schemaVersion: 1,
    };
    expect(seal(shuffled).revisionDigest).toBe(expected);
    const withSecond = {
      ...vector,
      criteria: [
        ...vector.criteria,
        {
          id: "extra",
          mode: "advisory",
          visibility: "public",
          kind: "manual_evidence",
          parameters: { review: "required" },
        },
      ],
    };
    const reversed = { ...withSecond, criteria: [...withSecond.criteria].reverse() };
    expect(seal(withSecond).revisionDigest).not.toBe(seal(reversed).revisionDigest);
  });

  it("changes identity for every authored decision field", () => {
    const variants = [
      { ...vector, assessmentId: "vector2" },
      { ...vector, revision: "rev2" },
      { ...vector, policyVersion: "policy2" },
      { ...vector, criteria: [{ ...vector.criteria[0], mode: "advisory" }, ...vector.criteria.slice(1),
        { id: "mandatory", mode: "required", visibility: "public", kind: "manual_evidence", parameters: { review: "required" } }] },
      { ...vector, criteria: [{ ...vector.criteria[0], parameters: { expected: { type: "literal", value: "café" } } }] },
      { ...vector, criteria: [{ ...vector.criteria[0], id: "renamed" }] },
    ];
    for (const changed of variants) {
      const changedHash = computeDefinitionDigest(changed);
      expect(changedHash.ok).toBe(true);
      if (changedHash.ok) expect(changedHash.value).not.toBe(expected);
    }
    const normalized = {
      ...vector,
      criteria: [{
        ...vector.criteria[0],
        kind: "normalized_text",
        parameters: {
          expected: { type: "literal", value: "café\n" },
          normalization: {
            lineEndings: "lf", unicode: "NFC", case: "sensitive",
            whitespace: "preserve", trim: "none",
          },
        },
      }],
    };
    const altered = {
      ...normalized,
      criteria: [{
        ...normalized.criteria[0],
        parameters: { ...normalized.criteria[0].parameters, normalization: {
          ...normalized.criteria[0].parameters.normalization, case: "fold",
        } },
      }],
    };
    expect(seal(normalized).revisionDigest).not.toBe(seal(altered).revisionDigest);
  });

  it("rejects a changed body with the same old digest using a value-free reason", () => {
    const good = seal(vector);
    const tampered = {
      ...good,
      criteria: [{ ...good.criteria[0], parameters: { expected: { type: "literal", value: "PRIVATE_MARKER" } } }],
    };
    const integrity = verifyAssessmentDefinition(tampered);
    expect(integrity).toEqual({
      ok: false,
      domain: "invalid_definition",
      diagnostics: [{ path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" }],
    });
    expect(JSON.stringify(integrity)).not.toContain("PRIVATE_MARKER");
    const forged = evaluateVerified(tampered, observed(good.revisionDigest, "PRIVATE_MARKER"));
    expect(forged.outcome).toBe("invalid_definition");
    expect("findings" in forged).toBe(false);
    // The deliberately unverified low-level comparator still accepts caller
    // claims: this is why the explicit verified API must be selected.
    expect(evaluate(tampered, observed(good.revisionDigest, "PRIVATE_MARKER")).outcome).toBe("pass");
  });

  it("evaluates a genuine content-bound definition using matching evidence", () => {
    const signed = seal(vector);
    expect(evaluateVerified(signed, observed(signed.revisionDigest)).outcome).toBe("pass");
    expect(evaluateVerified(signed, observed(signed.revisionDigest, "wrong")).outcome).toBe("fail");
    expect(evaluateVerified(signed, observed("sha256:" + "b".repeat(64))).outcome)
      .toBe("invalid_evidence");
  });

  it("rejects untrusted or malformed unsigned drafts without invoking getters", () => {
    expect(parseAssessmentDefinitionDraft({ ...vector, revisionDigest: expected }).ok).toBe(false);
    expect(computeDefinitionDigest({ ...vector, revisionDigest: expected }).ok).toBe(false);
    expect(createAssessmentDefinition({ ...vector, criteria: [] }).ok).toBe(false);
    expect(computeDefinitionDigest({ ...vector, policyVersion: "latest" }).ok).toBe(false);
    const poisoned = JSON.parse('{"schemaVersion":1,"__proto__":{"spoof":true}}');
    expect(createAssessmentDefinition(poisoned).ok).toBe(false);
    let access = 0;
    const accessor = { ...vector };
    Object.defineProperty(accessor, "criteria", {
      enumerable: true,
      get() {
        access++;
        return [];
      },
    });
    expect(computeDefinitionDigest(accessor).ok).toBe(false);
    expect(access).toBe(0);
  });

  it("holds the authored body independent of source object mutations", () => {
    const mutable = structuredClone(vector);
    const sealed = seal(mutable);
    mutable.criteria[0].parameters.expected.value = "rewritten";
    expect(verifyAssessmentDefinition(sealed).ok).toBe(true);
    expect(sealed.criteria[0].parameters.expected.value).toBe("café\n");
  });

  it("rejects invalid digest before invoking an optional observation port", async () => {
    const good = seal(vector);
    const poisoned = { ...good, policyVersion: "newPolicy" };
    const port = { observe: vi.fn(async () => ({ ignored: true })) };
    const result = await collectVerifiedObservations(
      poisoned,
      { ...observed(good.revisionDigest), observations: [] },
      port,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe("invalid_definition");
    expect(port.observe).not.toHaveBeenCalled();
  });

  it("guards provider requests with the sealed digest", async () => {
    const sealed = seal(vector);
    const port = {
      observe: vi.fn(async (request: unknown) => {
        expect(request).toMatchObject({
          definition: { revisionDigest: sealed.revisionDigest },
        });
        return {
          schemaVersion: 1,
          definition: { assessmentId: "vector", revision: "rev1", revisionDigest: sealed.revisionDigest },
          provenance: {
            adapterId: "fixture",
            adapterVersion: "v1",
            runRef: "run1",
            toolchainId: "node",
            toolchainVersion: "v24",
            capturedStdoutBytes: 0,
            capturedStderrBytes: 0,
            stdoutTruncated: false,
            stderrTruncated: false,
          },
          observations: [{
            criterionId: "output",
            evidenceRef: "port1",
            kind: "text",
            completeness: "complete",
            value: "café\n",
          }],
        };
      }),
    };
    const result = await collectVerifiedObservations(
      sealed,
      { ...observed(sealed.revisionDigest), observations: [] },
      port,
    );
    expect(port.observe).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(evaluateVerified(sealed, result.evidence).outcome).toBe("pass");
    }
  });

  it("binds lengthy Unicode and numeric values to independent Node SHA-256 bytes", () => {
    const large = {
      ...vector,
      criteria: [{
        ...vector.criteria[0],
        kind: "set_equivalence",
        parameters: {
          expected: { type: "literal", value: Array.from({ length: 80 }, (_, i) => "élément-" + i) },
          itemType: "string",
          order: "ignore",
          duplicates: "respect",
        },
      }],
    };
    const result = computeDefinitionDigest(large);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Canonical object-ordering verified against a separately constructed,
      // consistently ordered representation, not this implementation's code.
      const p = large.criteria[0].parameters;
      const encoded = JSON.stringify({
        assessmentId: "vector",
        criteria: [{
          id: "output",
          kind: "set_equivalence",
          mode: "required",
          parameters: {
            duplicates: p.duplicates,
            expected: { type: "literal", value: p.expected.value },
            itemType: p.itemType,
            order: p.order,
          },
          visibility: "public",
        }],
        policyVersion: "policy1",
        revision: "rev1",
        schemaVersion: 1,
      });
      const independent = "sha256:" + createHash("sha256")
        .update("assay:definition:v1\n" + encoded).digest("hex");
      expect(result.value).toBe(independent);
    }
  });
});
