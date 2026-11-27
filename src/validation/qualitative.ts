import { CONTRACT_LIMITS } from "../contracts/common";
import { choice, type Diagnostics, digest, identifier, list, object, revision } from "./shared";

const encoder = new TextEncoder();

/** Validate the closed inert review record; never resolve citations or authenticate claims. */
export function validateQualitativeReview(
  observation: Record<string, unknown>,
  artifactDigest: unknown,
  path: string,
  issues: Diagnostics,
): void {
  const fields = [
    "criterionId",
    "evidenceRef",
    "completeness",
    "kind",
    "origin",
    "reviewPolicyId",
    "reviewPolicyVersion",
    "reviewer",
    "uncertainty",
    "feedback",
    "citations",
  ];
  object(observation, path, fields, fields, issues);
  identifier(observation.criterionId, `${path}.criterionId`, issues);
  identifier(observation.evidenceRef, `${path}.evidenceRef`, issues);
  choice(observation.completeness, ["complete", "truncated"], `${path}.completeness`, issues);
  identifier(observation.reviewPolicyId, `${path}.reviewPolicyId`, issues);
  revision(observation.reviewPolicyVersion, `${path}.reviewPolicyVersion`, issues);
  choice(observation.uncertainty, ["low", "medium", "high", "unknown"], `${path}.uncertainty`, issues);

  const origin = observation.origin;
  const originPath = `${path}.origin`;
  const originFields = ["kind", "artifactDigest", "sourceRef"];
  if (object(origin, originPath, originFields, originFields, issues)) {
    choice(origin.kind, ["artifact"], `${originPath}.kind`, issues);
    digest(origin.artifactDigest, `${originPath}.artifactDigest`, issues);
    identifier(origin.sourceRef, `${originPath}.sourceRef`, issues);
    if (typeof artifactDigest !== "string" || origin.artifactDigest !== artifactDigest)
      issues.add(originPath, "MISMATCHED_ORIGIN");
  }

  const reviewer = observation.reviewer;
  const rp = `${path}.reviewer`;
  if (reviewer !== null && typeof reviewer === "object" && !Array.isArray(reviewer)) {
    const claim = reviewer as Record<string, unknown>;
    if (claim.kind === "human") {
      const keys = ["kind", "reviewerId", "reviewerVersion"];
      object(claim, rp, keys, keys, issues);
      identifier(claim.reviewerId, `${rp}.reviewerId`, issues);
      revision(claim.reviewerVersion, `${rp}.reviewerVersion`, issues);
    } else if (claim.kind === "model") {
      const keys = ["kind", "providerId", "modelId", "modelVersion", "promptId", "promptVersion"];
      object(claim, rp, keys, keys, issues);
      identifier(claim.providerId, `${rp}.providerId`, issues);
      identifier(claim.modelId, `${rp}.modelId`, issues);
      revision(claim.modelVersion, `${rp}.modelVersion`, issues);
      identifier(claim.promptId, `${rp}.promptId`, issues);
      revision(claim.promptVersion, `${rp}.promptVersion`, issues);
    } else issues.add(`${rp}.kind`, "INVALID_VALUE");
  } else issues.add(rp, "INVALID_TYPE");

  const feedback = observation.feedback;
  const fp = `${path}.feedback`;
  if (typeof feedback !== "string" || feedback.length === 0) issues.add(fp, "INVALID_VALUE");
  else if (
    feedback.length > CONTRACT_LIMITS.maxReviewFeedbackLength ||
    encoder.encode(feedback).byteLength > CONTRACT_LIMITS.maxReviewFeedbackBytes
  ) {
    issues.add(fp, "INPUT_TOO_LARGE");
  } else {
    // Code-point iteration preserves paired surrogates; lone surrogates are invalid.
    for (const character of feedback) {
      const cp = character.codePointAt(0) ?? 0;
      if (
        (cp < 32 && cp !== 9 && cp !== 10) ||
        (cp >= 127 && cp <= 159) ||
        (cp >= 0xd800 && cp <= 0xdfff)
      ) {
        issues.add(fp, "INVALID_VALUE");
        break;
      }
    }
  }

  const citations = observation.citations;
  const cp = `${path}.citations`;
  if (!list(citations, cp, issues, CONTRACT_LIMITS.maxReviewCitations)) return;
  if (citations.length === 0) issues.add(cp, "INVALID_VALUE");
  const seen = new Set<string>();
  for (const [index, citation] of citations.entries()) {
    const p = `${cp}[${index}]`;
    const keys = ["artifactRef", "startByte", "endByte"];
    if (!object(citation, p, keys, keys, issues)) continue;
    identifier(citation.artifactRef, `${p}.artifactRef`, issues);
    const { startByte, endByte } = citation;
    if (
      typeof startByte !== "number" ||
      typeof endByte !== "number" ||
      !Number.isSafeInteger(startByte) ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 ||
      endByte <= startByte
    ) {
      issues.add(p, "INVALID_VALUE");
      continue;
    }
    const key = JSON.stringify([citation.artifactRef, startByte, endByte]);
    if (seen.has(key)) issues.add(p, "DUPLICATE_ID");
    seen.add(key);
  }
}
