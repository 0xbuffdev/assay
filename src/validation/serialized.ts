import { CONTRACT_LIMITS, type JsonValue } from "../contracts/common";
import type { DiagnosticCode, SerializedRecordResult } from "../contracts/validation";
import { BAD, Diagnostics, snapshot } from "./shared";

const encoder = new TextEncoder();

class DecodeError extends Error {
  constructor(readonly code: DiagnosticCode) {
    super(code);
  }
}

function reject(code: DiagnosticCode): never {
  throw new DecodeError(code);
}

function failure(code: DiagnosticCode): SerializedRecordResult {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([Object.freeze({ path: "$", code })]),
  });
}

/** Bound parser work and detect duplicate decoded names before JSON.parse loses them. */
function preflight(text: string): void {
  let index = 0;
  let nodes = 0;

  function whitespace(): void {
    while (
      text[index] === " " ||
      text[index] === "\t" ||
      text[index] === "\n" ||
      text[index] === "\r"
    ) {
      index++;
    }
  }

  function stringToken(): string {
    if (text[index] !== '"') reject("INVALID_JSON");
    const start = index++;
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') return text.slice(start, index);
      if (character === "\\") index++;
    }
    return reject("INVALID_JSON");
  }

  function value(depth: number): void {
    if (depth > CONTRACT_LIMITS.maxDepth) reject("INPUT_TOO_DEEP");
    if (++nodes > CONTRACT_LIMITS.maxNodes) reject("INPUT_TOO_LARGE");
    whitespace();
    if (text[index] === "{") {
      index++;
      whitespace();
      const names = new Set<string>();
      if (text[index] !== "}") {
        while (true) {
          whitespace();
          const name = JSON.parse(stringToken()) as string;
          if (name.length > CONTRACT_LIMITS.maxStringLength) reject("INPUT_TOO_LARGE");
          if (name === "__proto__" || name === "prototype" || name === "constructor") {
            reject("UNSAFE_KEY");
          }
          if (names.has(name)) reject("DUPLICATE_KEY");
          if (names.size >= CONTRACT_LIMITS.maxObjectKeys) reject("TOO_MANY_ITEMS");
          names.add(name);
          whitespace();
          if (text[index++] !== ":") reject("INVALID_JSON");
          value(depth + 1);
          whitespace();
          if (text[index] !== ",") break;
          index++;
        }
      }
      if (text[index++] !== "}") reject("INVALID_JSON");
    } else if (text[index] === "[") {
      index++;
      whitespace();
      let count = 0;
      if (text[index] !== "]") {
        while (true) {
          if (++count > CONTRACT_LIMITS.maxArrayLength) reject("TOO_MANY_ITEMS");
          value(depth + 1);
          whitespace();
          if (text[index] !== ",") break;
          index++;
        }
      }
      if (text[index++] !== "]") reject("INVALID_JSON");
    } else if (text[index] === '"') {
      stringToken();
    } else {
      // JSON.parse subsequently checks exact primitive syntax; this scan only
      // identifies the bounded token span without allocating an unbounded token.
      const start = index;
      while (index < text.length && !",]} \t\n\r".includes(text[index])) index++;
      if (start === index) reject("INVALID_JSON");
    }
  }

  whitespace();
  if (text[index] !== "{") reject("INVALID_TYPE");
  value(0);
  whitespace();
  if (index !== text.length) reject("INVALID_JSON");
}

/** Decode one inert JSON record. This is not contract or integrity verification. */
export function decodeSerializedRecord(input: unknown): SerializedRecordResult {
  if (typeof input !== "string") return failure("INVALID_TYPE");
  // UTF-8 cannot be shorter than the UTF-16 code-unit count. Reject before
  // encoding; the temporary encoder allocation is itself bounded.
  if (
    input.length > CONTRACT_LIMITS.maxSerializedBytes ||
    encoder.encode(input).byteLength > CONTRACT_LIMITS.maxSerializedBytes
  ) {
    return failure("INPUT_TOO_LARGE");
  }

  try {
    preflight(input);
    const issues = new Diagnostics();
    const data = snapshot(JSON.parse(input) as unknown, issues);
    if (data === BAD) {
      return failure(issues.entries[0]?.code ?? "INVALID_JSON");
    }
    return Object.freeze({ ok: true, value: data as Readonly<Record<string, JsonValue>> });
  } catch (error) {
    return failure(error instanceof DecodeError ? error.code : "INVALID_JSON");
  }
}
