import { ASSAY_SCHEMA_VERSION } from "./contracts";
import type {
  AssessmentDefinition,
  AssessmentDefinitionDraft,
  EvaluationResponse,
  ObservationCollectionResult,
  ObservationPort,
  ValidationResult,
} from "./contracts";
import { evaluate } from "./evaluate";
import { collectObservations } from "./observation";
import { parseAssessmentDefinition, parseAssessmentDefinitionDraft } from "./validation";

/**
 * Persistent schema-to-digest binding: schemaVersion: 1 ALWAYS uses digest v1.
 * Any change to the digest algorithm or canonical bytes requires a NEW schema
 * version. Never reinterpret an existing schema-1 record using a new profile.
 * This content identity does not authenticate a publisher or evidence origin.
 * See docs/integrity.md for the normative byte-level profile.
 */
export const ASSAY_DEFINITION_DIGEST_VERSION = "v1" as const;
const DIGEST_V1_SCHEMA_VERSION: typeof ASSAY_SCHEMA_VERSION = 1;
const DOMAIN = "assay:definition:v1\n";
const encoder = new TextEncoder();

// Pure, synchronous SHA-256; no Node-specific crypto, provider, I/O or runtime deps.
const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const ROUNDS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(message: Uint8Array): string {
  const length = Math.ceil((message.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(message);
  padded[message.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = message.byteLength * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x1_0000_0000), false);
  view.setUint32(length - 4, bits >>> 0, false);

  const state = Uint32Array.from(INITIAL);
  const words = new Uint32Array(64);
  for (let position = 0; position < length; position += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(position + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15];
      const y = words[i - 2];
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + ROUNDS[i] + words[i]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return `sha256:${Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("")}`;
}

/** Canonical JSON over already validated and frozen schema-shaped data. */
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported value in validated definition");
}

function hashDraft(draft: AssessmentDefinitionDraft): string {
  if (draft.schemaVersion !== DIGEST_V1_SCHEMA_VERSION) {
    throw new TypeError("Unsupported definition digest profile");
  }
  return sha256(encoder.encode(DOMAIN + canonical(draft)));
}

/** Calculate a versioned content hash from a validated unsigned definition. */
export function computeDefinitionDigest(draftInput: unknown): ValidationResult<string> {
  const checked = parseAssessmentDefinitionDraft(draftInput);
  if (!checked.ok) return checked;
  return Object.freeze({ ok: true, value: hashDraft(checked.value) });
}

/** Construct a frozen, bounded, content-bound definition from an unsigned draft. */
export function createAssessmentDefinition(
  draftInput: unknown,
): ValidationResult<AssessmentDefinition> {
  const checked = parseAssessmentDefinitionDraft(draftInput);
  if (!checked.ok) return checked;
  return parseAssessmentDefinition({
    ...checked.value,
    revisionDigest: hashDraft(checked.value),
  });
}

/** Verify content integrity only; the host must authenticate the publisher. */
export function verifyAssessmentDefinition(
  definitionInput: unknown,
): ValidationResult<AssessmentDefinition> {
  const checked = parseAssessmentDefinition(definitionInput);
  if (!checked.ok) return checked;
  const value = checked.value;
  const draft: AssessmentDefinitionDraft = {
    schemaVersion: value.schemaVersion,
    assessmentId: value.assessmentId,
    revision: value.revision,
    policyVersion: value.policyVersion,
    criteria: value.criteria,
  };
  if (value.revisionDigest !== hashDraft(draft)) {
    return Object.freeze({
      ok: false,
      domain: "invalid_definition",
      diagnostics: Object.freeze([
        Object.freeze({
          path: "$.revisionDigest",
          code: "DEFINITION_DIGEST_MISMATCH",
        }),
      ]),
    });
  }
  return checked;
}

/**
 * Guarded technical evaluation. evaluate() remains the unverified, pure
 * comparison primitive for caller-supplied definition identity claims.
 */
export function evaluateVerified(
  definitionInput: unknown,
  evidenceInput: unknown,
): EvaluationResponse {
  const checked = verifyAssessmentDefinition(definitionInput);
  if (!checked.ok) {
    return Object.freeze({ outcome: "invalid_definition", diagnostics: checked.diagnostics });
  }
  return evaluate(checked.value, evidenceInput);
}

/** Reject content changes before calling an injected observation provider. */
export async function collectVerifiedObservations(
  definitionInput: unknown,
  evidenceInput: unknown,
  port: ObservationPort,
): Promise<ObservationCollectionResult> {
  const checked = verifyAssessmentDefinition(definitionInput);
  if (!checked.ok) {
    return Object.freeze({
      ok: false,
      outcome: "invalid_definition",
      diagnostics: checked.diagnostics,
    });
  }
  return collectObservations(checked.value, evidenceInput, port);
}
