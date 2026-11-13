import ts from "typescript";

/** What the SDK's type says about one property path. */
export interface PropertyInfo {
  found: boolean;
  /** The first segment that is not declared (index signatures do not count). */
  missingAt?: string;
  /** Declared optional, or its type admits undefined. */
  optional: boolean;
  /** Its type admits null. */
  nullable: boolean;
}

export interface SdkTypes {
  /** Look `path` ("[]" for an array's items) up on the exported type `typeName`. */
  property(typeName: string, path: string[]): PropertyInfo;
  /** The string literals the exported union type `typeName` names (its `string & {}` catch-all is not one). */
  literals(typeName: string): string[];
  /** Whether the exported type also accepts any string (`string`, or the `string & {}` catch-all). */
  acceptsAnyString(typeName: string): boolean;
}

/**
 * Read the SDK's types with the TypeScript compiler, starting at `entryFile`
 * (a module that exports the types to inspect). Only declared properties count:
 * a field that is reachable only through an index signature
 * (`[key: string]: unknown`) is reported missing, because a caller gets no type
 * for it.
 */
export function loadSdkTypes(entryFile: string): SdkTypes {
  const program = ts.createProgram([entryFile], {
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    // Only the SDK's own declarations matter here; leaving out @types/node and
    // the DOM keeps this fast (Blob, AbortSignal, … resolve to error types,
    // which no checked path walks into).
    types: [],
    lib: ["lib.es2021.d.ts"],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entryFile);
  if (!source) throw new Error(`sdkTypes: cannot read ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`sdkTypes: ${entryFile} is not a module`);
  const exportsByName = new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.name, s]));

  const typeOf = (name: string): ts.Type => {
    let sym = exportsByName.get(name);
    if (!sym) throw new Error(`sdkTypes: ${entryFile} does not export ${name}`);
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return checker.getDeclaredTypeOfSymbol(sym);
  };

  const admits = (t: ts.Type, flag: ts.TypeFlags): boolean => {
    const loose = ts.TypeFlags.Any | ts.TypeFlags.Unknown;
    const parts = t.isUnion() ? t.types : [t];
    return parts.some((p) => !!(p.flags & (flag | loose)));
  };

  return {
    property(typeName, path) {
      let t = typeOf(typeName);
      let optional = false;
      let nullable = false;
      for (let i = 0; i < path.length; i++) {
        const base = checker.getNonNullableType(t);
        const missing = (): PropertyInfo => ({
          found: false,
          missingAt: path.slice(0, i + 1).join("."),
          optional,
          nullable,
        });
        if (path[i] === "[]") {
          const element = checker.getIndexTypeOfType(base, ts.IndexKind.Number);
          if (!element) return missing();
          t = element;
          optional = false;
          nullable = admits(element, ts.TypeFlags.Null);
          continue;
        }
        const prop = checker.getPropertyOfType(base, path[i]);
        if (!prop) return missing();
        t = checker.getTypeOfSymbol(prop);
        optional = !!(prop.flags & ts.SymbolFlags.Optional) || admits(t, ts.TypeFlags.Undefined);
        nullable = admits(t, ts.TypeFlags.Null);
      }
      return { found: true, optional, nullable };
    },
    literals(typeName) {
      const t = typeOf(typeName);
      const parts = t.isUnion() ? t.types : [t];
      return parts.filter((p): p is ts.StringLiteralType => p.isStringLiteral()).map((p) => p.value);
    },
    acceptsAnyString(typeName) {
      const t = typeOf(typeName);
      const parts = t.isUnion() ? t.types : [t];
      const isString = (p: ts.Type) => !!(p.flags & ts.TypeFlags.String);
      return parts.some((p) => isString(p) || (p.isIntersection() && p.types.some(isString)));
    },
  };
}
