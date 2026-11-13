/**
 * A small JSON Schema (2020-12) validator and walker for the contract test.
 *
 * This repo installs no JSON Schema validator (no ajv), and adding a dependency
 * for one test is not worth it, so this implements exactly the keywords the
 * server's openapi.json uses — and THROWS on any other keyword, so that a
 * schema which starts using one fails the test loudly instead of passing
 * unchecked. Extend it when that happens.
 */

export type Schema = Record<string, any>;

const ANNOTATIONS = ["title", "description", "examples"];
const KEYWORDS = new Set([
  ...ANNOTATIONS,
  "$ref",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "unevaluatedProperties",
  "dependentRequired",
  "items",
  "minItems",
  "maxItems",
  "contains",
  "minContains",
  "maxContains",
  "minLength",
  "pattern",
  "minimum",
  "maximum",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

function isType(type: string, v: unknown): boolean {
  switch (type) {
    case "null":
      return v === null;
    case "boolean":
      return typeof v === "boolean";
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "array":
      return Array.isArray(v);
    case "object":
      return isPlainObject(v);
    default:
      throw new Error(`validator: unknown type "${type}"`);
  }
}

export interface Validator {
  /** Resolve a local `#/...` reference against the document. */
  resolve(ref: string): Schema;
  /** Every violation of `schema` by `value`, as "path: reason" lines; empty when valid. */
  validate(schema: Schema | boolean, value: unknown, at?: string): string[];
  /** `schema` and every schema it is made of ($ref, allOf, anyOf, then, else), flattened. */
  branches(schema: Schema): Schema[];
}

export function makeValidator(doc: unknown): Validator {
  const resolve = (ref: string): Schema => {
    if (!ref.startsWith("#/")) throw new Error(`validator: only local refs are supported, got ${ref}`);
    const target = ref
      .slice(2)
      .split("/")
      .reduce<any>((node, key) => node?.[decodeURIComponent(key)], doc);
    if (!target) throw new Error(`validator: unresolved ref ${ref}`);
    return target;
  };

  const branches = (schema: Schema): Schema[] => {
    const out: Schema[] = [];
    const visit = (s: unknown) => {
      if (!isPlainObject(s) || out.includes(s)) return;
      out.push(s);
      if (typeof s.$ref === "string") visit(resolve(s.$ref));
      for (const k of ["allOf", "anyOf"]) for (const sub of (s[k] as unknown[]) ?? []) visit(sub);
      visit(s.then);
      visit(s.else);
    };
    visit(schema);
    return out;
  };

  /** Property names a schema declares itself, through $ref and allOf (for unevaluatedProperties). */
  const declared = (schema: Schema, seen = new Set<Schema>()): Set<string> => {
    const names = new Set<string>();
    if (seen.has(schema)) return names;
    seen.add(schema);
    for (const k of Object.keys(schema.properties ?? {})) names.add(k);
    if (typeof schema.$ref === "string") for (const k of declared(resolve(schema.$ref), seen)) names.add(k);
    for (const sub of schema.allOf ?? []) for (const k of declared(sub, seen)) names.add(k);
    return names;
  };

  const validate = (schema: Schema | boolean, value: unknown, at = "$"): string[] => {
    if (schema === true) return [];
    if (schema === false) return [`${at}: no value is allowed here`];
    for (const k of Object.keys(schema)) {
      if (!KEYWORDS.has(k)) throw new Error(`validator: keyword "${k}" is not implemented (at ${at})`);
    }
    const errs: string[] = [];
    const fail = (msg: string) => errs.push(`${at}: ${msg}`);

    if (typeof schema.$ref === "string") errs.push(...validate(resolve(schema.$ref), value, at));
    if (schema.type !== undefined) {
      const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => isType(t, value))) fail(`expected ${types.join(" | ")}, got ${JSON.stringify(value)}`);
    }
    if ("const" in schema && !deepEqual(schema.const, value)) fail(`expected ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((e: unknown) => deepEqual(e, value))) {
      fail(`expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    }

    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) fail(`shorter than ${schema.minLength}`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
        fail(`does not match ${schema.pattern}`);
      }
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
      if (schema.items !== undefined) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${at}[${i}]`)));
      if (schema.contains !== undefined) {
        const n = value.filter((v) => validate(schema.contains, v).length === 0).length;
        const min = schema.minContains ?? 1;
        const max = schema.maxContains ?? Infinity;
        if (n < min || n > max) fail(`${n} items match "contains" (allowed ${min}..${max})`);
      }
    }
    if (isPlainObject(value)) {
      for (const k of schema.required ?? []) if (!(k in value)) fail(`missing required "${k}"`);
      const props: Record<string, Schema> = schema.properties ?? {};
      for (const [k, v] of Object.entries(value)) {
        if (k in props) errs.push(...validate(props[k], v, `${at}.${k}`));
        else if (schema.additionalProperties !== undefined) {
          errs.push(...validate(schema.additionalProperties, v, `${at}.${k}`));
        }
      }
      for (const [k, deps] of Object.entries<string[]>(schema.dependentRequired ?? {})) {
        if (k in value) for (const d of deps) if (!(d in value)) fail(`"${k}" requires "${d}"`);
      }
      if (schema.unevaluatedProperties !== undefined) {
        const known = declared(schema);
        for (const [k, v] of Object.entries(value)) {
          if (!known.has(k)) errs.push(...validate(schema.unevaluatedProperties, v, `${at}.${k}`));
        }
      }
    }

    for (const sub of schema.allOf ?? []) errs.push(...validate(sub, value, at));
    if (Array.isArray(schema.anyOf)) {
      const results = schema.anyOf.map((sub: Schema) => validate(sub, value, at));
      if (!results.some((r: string[]) => r.length === 0)) {
        fail(`matches no anyOf branch (${results.map((r: string[]) => r[0]).join(" / ")})`);
      }
    }
    if (schema.not !== undefined && validate(schema.not, value, at).length === 0) fail(`matches "not"`);
    if (schema.if !== undefined) {
      const branch = validate(schema.if, value, at).length === 0 ? schema.then : schema.else;
      if (branch !== undefined) errs.push(...validate(branch, value, at));
    }
    return errs;
  };

  return { resolve, validate, branches };
}

/** A property the schema documents, by path ("[]" for an array's items). */
export interface DocumentedPath {
  path: string[];
  /** In its object's `required` list. */
  required: boolean;
  /** The schema allows null here. */
  nullable: boolean;
}

/** Every property path `schema` documents, depth first, with whether it is required and nullable. */
export function documentedPaths(v: Validator, schema: Schema): DocumentedPath[] {
  const out: DocumentedPath[] = [];
  const nullable = (s: Schema) =>
    v.branches(s).some(
      (b) =>
        b.type === "null" ||
        (Array.isArray(b.type) && b.type.includes("null")) ||
        (Array.isArray(b.enum) && b.enum.includes(null)) ||
        ("const" in b && b.const === null),
    );
  const walk = (s: Schema, prefix: string[], required: boolean, depth: number) => {
    if (depth > 12) throw new Error(`documentedPaths: too deep at ${prefix.join(".")}`);
    if (prefix.length) out.push({ path: prefix, required, nullable: nullable(s) });
    const props = new Map<string, { schemas: Schema[]; required: boolean }>();
    const items: Schema[] = [];
    for (const b of v.branches(s)) {
      for (const [k, ps] of Object.entries<Schema>(b.properties ?? {})) {
        const e = props.get(k) ?? { schemas: [], required: false };
        e.schemas.push(ps);
        if ((b.required ?? []).includes(k)) e.required = true;
        props.set(k, e);
      }
      if (b.items !== undefined) items.push(b.items);
    }
    for (const [k, e] of props) walk({ anyOf: e.schemas }, [...prefix, k], e.required, depth + 1);
    if (items.length) walk({ anyOf: items }, [...prefix, "[]"], true, depth + 1);
  };
  walk(schema, [], true, 0);
  return out;
}

/**
 * Every (object schema, property) pair reachable from `schema`, keyed so that a
 * sub-schema shared through $ref (PlaygroundMediaUsage, StepError, …) is one
 * entry however many replies use it.
 */
export function schemaProperties(v: Validator, schema: Schema): Map<Schema, Set<string>> {
  const out = new Map<Schema, Set<string>>();
  const seen = new Set<Schema>();
  const walk = (s: Schema) => {
    for (const b of v.branches(s)) {
      if (seen.has(b)) continue;
      seen.add(b);
      for (const [k, ps] of Object.entries<Schema>(b.properties ?? {})) {
        if (!out.has(b)) out.set(b, new Set());
        out.get(b)!.add(k);
        walk(ps);
      }
      if (b.items !== undefined) walk(b.items);
    }
  };
  walk(schema);
  return out;
}

/** Record which (object schema, property) pairs `value` fills in, walking it alongside `schema`. */
export function markCovered(v: Validator, schema: Schema, value: unknown, covered: Map<Schema, Set<string>>) {
  for (const b of v.branches(schema)) {
    if (isPlainObject(value) && b.properties) {
      for (const [k, ps] of Object.entries<Schema>(b.properties)) {
        if (!(k in value)) continue;
        if (!covered.has(b)) covered.set(b, new Set());
        covered.get(b)!.add(k);
        markCovered(v, ps, value[k], covered);
      }
    }
    if (Array.isArray(value) && b.items !== undefined) {
      for (const item of value) markCovered(v, b.items, item, covered);
    }
  }
}
