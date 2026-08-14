import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeToolSchema } from "../request/schema.js";

describe("sanitizeToolSchema", () => {
  it("flattens a plain object schema", () => {
    const result = sanitizeToolSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 1 },
      },
      required: ["name"],
    });

    assert.deepEqual(result, {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 1 },
      },
      required: ["name"],
    });
  });

  it("drops $ref/$defs/$schema and resolves #/ pointers", () => {
    const result = sanitizeToolSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: { coord: { type: "object", properties: { x: { type: "number" } } } },
      type: "object",
      properties: {
        pos: { $ref: "#/$defs/coord" },
        label: { type: "string", description: "a label" },
      },
    });

    assert.deepEqual(result, {
      type: "object",
      properties: {
        pos: { type: "object", properties: { x: { type: "number" } } },
        label: { type: "string", description: "a label" },
      },
    });
  });

  it("does not recurse forever on a cyclic (non-$ref) schema", () => {
    // A property that references the same schema object creates a cycle that
    // used to blow the stack. It must terminate and emit an empty schema for
    // the back-edge.
    const node: Record<string, unknown> = {
      type: "object",
      properties: {},
    };
    node.properties = { self: node };

    const result = sanitizeToolSchema(node) as { properties: Record<string, unknown> };

    assert.deepEqual(result.properties.self, {});
  });

  it("preserves a shared (DAG) sub-schema used by two properties", () => {
    const shared = { type: "string", maxLength: 10 };
    const result = sanitizeToolSchema({
      type: "object",
      properties: { a: shared, b: shared },
    }) as { properties: Record<string, unknown> };

    assert.deepEqual(result.properties.a, { type: "string", maxLength: 10 });
    assert.deepEqual(result.properties.b, { type: "string", maxLength: 10 });
  });

  it("falls back to an empty object schema for non-object input", () => {
    assert.deepEqual(sanitizeToolSchema(undefined), { type: "object", properties: {} });
  });

  it("preserves a top-level enum instead of flattening it away", () => {
    const result = sanitizeToolSchema({ enum: ["fast", "balanced", "thorough"] });
    assert.deepEqual(result, { type: "object", properties: {}, enum: ["fast", "balanced", "thorough"] });
  });

  it("keeps pattern/format/default keywords on properties", () => {
    const result = sanitizeToolSchema({
      type: "object",
      properties: {
        code: { type: "string", pattern: "^[a-z]+$", description: "a code" },
        mode: { type: "string", enum: ["on", "off"], default: "off" },
      },
    }) as { properties: Record<string, unknown> };

    assert.deepEqual(result.properties.code, { type: "string", pattern: "^[a-z]+$", description: "a code" });
    assert.deepEqual(result.properties.mode, { type: "string", enum: ["on", "off"], default: "off" });
  });
});
