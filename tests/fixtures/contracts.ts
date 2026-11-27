import { createHash } from "node:crypto";
import {
  type AssessmentDefinition,
  type AssessmentDefinitionDraft,
  createAssessmentDefinition,
  type DefinitionReference,
  type EvaluationResult,
  type EvidenceBundle,
} from "../../src/index";

export function sealDefinition(draft: AssessmentDefinitionDraft<1>): AssessmentDefinition<1> {
  const checked = createAssessmentDefinition({
    schemaVersion: draft.schemaVersion,
    assessmentId: draft.assessmentId,
    revision: draft.revision,
    policyVersion: draft.policyVersion,
    criteria: draft.criteria,
  });
  if (!checked.ok || checked.value.schemaVersion !== 1) {
    throw new Error("Invalid authored test fixture");
  }
  return checked.value;
}

export function referenceOf(definition: AssessmentDefinition): DefinitionReference {
  return {
    assessmentId: definition.assessmentId,
    revision: definition.revision,
    revisionDigest: definition.revisionDigest,
  };
}

export const digestA = `sha256:${"a".repeat(64)}`;
export const digestB = `sha256:${"b".repeat(64)}`;

export function definition(): AssessmentDefinition<1> {
  return {
    schemaVersion: 1,
    assessmentId: "assay-demo",
    revision: "rev1",
    revisionDigest: digestA,
    policyVersion: "policy1",
    criteria: [
      {
        id: "output",
        mode: "required",
        visibility: "public",
        kind: "exact_text",
        parameters: { expected: { type: "literal", value: "42\n" } },
      },
      {
        id: "explanation",
        mode: "advisory",
        visibility: "restricted",
        kind: "normalized_text",
        parameters: {
          expected: { type: "reference", referenceId: "reviewer-reference" },
          normalization: {
            lineEndings: "lf",
            unicode: "NFC",
            case: "sensitive",
            whitespace: "preserve",
            trim: "none",
          },
        },
      },
      {
        id: "quantity",
        mode: "required",
        visibility: "public",
        kind: "number_with_tolerance",
        parameters: {
          expected: { type: "literal", value: 42 },
          tolerance: { absolute: 0, relative: 0 },
        },
      },
      {
        id: "members",
        mode: "advisory",
        visibility: "public",
        kind: "set_equivalence",
        parameters: {
          expected: { type: "literal", value: ["a", "b"] },
          itemType: "string",
          order: "ignore",
          duplicates: "ignore",
        },
      },
      {
        id: "program",
        mode: "advisory",
        visibility: "restricted",
        kind: "observed_execution",
        parameters: {
          assertions: [{ id: "unit1", referenceId: "verified-unit1" }],
        },
      },
      {
        id: "report",
        mode: "advisory",
        visibility: "public",
        kind: "manual_evidence",
        parameters: { review: "required" },
      },
    ],
  };
}

export function evidence(): EvidenceBundle {
  return sealEvidenceFixture({
    schemaVersion: 2,
    definition: {
      assessmentId: "assay-demo",
      revision: "rev1",
      revisionDigest: digestA,
    },
    observations: [
      {
        criterionId: "output",
        evidenceRef: "ev-output",
        kind: "text",
        completeness: "complete",
        value: "42\n",
      },
      {
        criterionId: "quantity",
        evidenceRef: "ev-number",
        kind: "number",
        completeness: "truncated",
        value: 42,
      },
      {
        criterionId: "program",
        evidenceRef: "ev-execution",
        kind: "execution",
        completeness: "complete",
        runRef: "run1",
        assertions: [{ assertionId: "unit1", state: "unknown" }],
      },
    ],
  });
}

export function result(): EvaluationResult {
  return {
    schemaVersion: 2,
    evidenceDigest: digestB,
    outcome: "inconclusive",
    definition: {
      assessmentId: "assay-demo",
      revision: "rev1",
      revisionDigest: digestA,
    },
    policyVersion: "policy1",
    findings: [
      {
        criterionId: "output",
        outcome: "inconclusive",
        reasonCode: "REFERENCE_PENDING",
        evidenceRefs: ["ev-output"],
        evaluatorId: "assay",
        evaluatorVersion: "v1",
      },
    ],
    evaluator: { id: "assay", version: "v1" },
    warnings: ["REFERENCE_PENDING"],
  };
}

/** Independent fixture sealer for inert synthetic input, including negative cases. */
export function sealEvidenceFixture(
  input: Omit<EvidenceBundle, "observations" | "evidenceDigest"> & {
    observations: readonly unknown[];
    evidenceDigest?: string;
  },
): EvidenceBundle {
  const { evidenceDigest: _previous, ...content } = input;
  const bytes = JSON.stringify(content, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  });
  const evidenceDigest = `sha256:${createHash("sha256")
    .update(`assay:evidence:v2\n${bytes}`, "utf8")
    .digest("hex")}`;
  return { ...content, evidenceDigest } as EvidenceBundle;
}
