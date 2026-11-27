import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { CONTRACT_LIMITS, decodeSerializedRecord, parseAssessmentDefinition } from "../src/index";

describe("bounded serialized record decoding", () => {
  it("returns frozen inert data without treating it as a validated contract", () => {
    const result = decodeSerializedRecord('{"a":[{"b":"\u0061"},null,true,1]}');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected decoded record");
    expect(result.value).toEqual({ a: [{ b: "a" }, null, true, 1] });
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(Object.isFrozen(result.value.a)).toBe(true);
    expect(parseAssessmentDefinition(result.value).ok).toBe(false);
  });

  it.each([
    '{"canary":1,"canary":2}',
    '{"nested":{"x":1,"\\u0078":2}}',
    '{"nested":[{"a":1,"a":2}]}',
    '{"\\uD83D\\uDE00":1,"😀":2}',
  ])("rejects duplicate decoded keys without leaking them", (text) => {
    expect(decodeSerializedRecord(text)).toEqual({
      ok: false,
      diagnostics: [{ path: "$", code: "DUPLICATE_KEY" }],
    });
  });

  it.each([
    '{"__proto__":1}',
    '{"nested":{"\\u0063onstructor":1}}',
    '{"nested":[{"prototype":1}]}',
  ])("rejects unsafe keys", (text) => {
    expect(decodeSerializedRecord(text)).toEqual({
      ok: false,
      diagnostics: [{ path: "$", code: "UNSAFE_KEY" }],
    });
  });

  it.each([
    '{"secret-canary":',
    '{"secret-canary":01}',
    '{"secret-canary":"\\q"}',
    '{"secret-canary":[1,]}',
    '{"secret-canary":1,}',
    '{"secret-canary":1}{}',
    '{"secret-canary":1e999}',
    '["secret-canary"]',
  ])("rejects malformed or unsupported input with redacted diagnostics", (text) => {
    const result = decodeSerializedRecord(text);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-canary");
  });

  it("does not inspect executable or boxed string input", () => {
    let calls = 0;
    const input = new Proxy({}, {
      get() {
        calls++;
        throw new Error("canary");
      },
    });
    expect(decodeSerializedRecord(input).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("counts serialized UTF-8 bytes including escapes and whitespace", () => {
    const cap = CONTRACT_LIMITS.maxSerializedBytes;
    const json = '{"x":"😀"}';
    const bytes = new TextEncoder().encode(json).byteLength;
    const exact = json + " ".repeat(cap - bytes);
    expect(decodeSerializedRecord(exact).ok).toBe(true);
    expect(decodeSerializedRecord(exact + " ").ok).toBe(false);
    expect(decodeSerializedRecord(" ".repeat(cap - 2) + "{}").ok).toBe(true);
    expect(decodeSerializedRecord(" ".repeat(cap - 1) + "{}").ok).toBe(false);
    expect(CONTRACT_LIMITS.maxCombinedSerializedBytes).toBe(3 * cap);
  });

  it("bounds decoded depth, nodes, string/key length and collection sizes", () => {
    const deep = (depth: number) => '{"x":'.repeat(depth) + "0" + "}".repeat(depth);
    expect(decodeSerializedRecord(deep(12)).ok).toBe(true);
    expect(decodeSerializedRecord(deep(13)).ok).toBe(false);
    const array = (count: number) => JSON.stringify({ x: Array(count).fill(0) });
    expect(decodeSerializedRecord(array(128)).ok).toBe(true);
    expect(decodeSerializedRecord(array(129)).ok).toBe(false);
    const object = (count: number) =>
      JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), 0])));
    expect(decodeSerializedRecord(object(32)).ok).toBe(true);
    expect(decodeSerializedRecord(object(33)).ok).toBe(false);
    expect(decodeSerializedRecord(JSON.stringify({ x: "a".repeat(16_384) })).ok).toBe(true);
    expect(decodeSerializedRecord(JSON.stringify({ x: "a".repeat(16_385) })).ok).toBe(false);
    expect(decodeSerializedRecord(JSON.stringify({ ["a".repeat(16_384)]: 0 })).ok).toBe(true);
    expect(decodeSerializedRecord(JSON.stringify({ ["a".repeat(16_385)]: 0 })).ok).toBe(false);
    // Root + containing array + 32 child arrays + 4,062 leaves = 4,096 nodes.
    const nodes = Array.from({ length: 32 }, (_, i) => Array(i === 31 ? 94 : 128).fill(0));
    expect(decodeSerializedRecord(JSON.stringify({ nodes })).ok).toBe(true);
    nodes[31].push(0);
    expect(decodeSerializedRecord(JSON.stringify({ nodes })).ok).toBe(false);
  });

  it("reports a maximum-byte/node workload without a machine-specific timing gate", () => {
    const nodes = Array.from({ length: 32 }, (_, i) =>
      Array(i === 31 ? 94 : 128).fill("a".repeat(60)),
    );
    const json = JSON.stringify({ nodes });
    const input = json + " ".repeat(CONTRACT_LIMITS.maxSerializedBytes - json.length);
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const result = decodeSerializedRecord(input);
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    console.info("AY-I21 maximum workload", {
      node: process.version,
      platform: process.platform,
      bytes: input.length,
      nodes: 4096,
      elapsedMs: elapsed,
      heapDeltaBytes: process.memoryUsage().heapUsed - before,
    });
  });
});
