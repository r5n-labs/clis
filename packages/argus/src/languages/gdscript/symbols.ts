export type SourceExpression =
  | { kind: "name"; name: string }
  | { kind: "path"; path: string }
  | { kind: "member"; receiver: SourceExpression; name: string }
  | { kind: "call"; callee: SourceExpression; arguments?: SourceExpression[] }
  | { kind: "value"; text?: string }
  | { kind: "unknown"; text: string };

export type SourceBinding = { name: string; value: SourceExpression; typed: boolean; initialiser?: SourceExpression };
export type MethodSymbols = {
  name: string;
  bindings: SourceBinding[];
  operations: SourceExpression[];
  uses: string[];
  returnType?: SourceExpression;
};
export type DeclarationSymbols = { source: string; binding?: string; uses: readonly string[] };
export type ClassSymbols = {
  declarations: readonly DeclarationSymbols[];
  owner: string;
  globalName?: string;
  base?: SourceExpression;
  bindings: SourceBinding[];
  operations: SourceExpression[];
  methods: MethodSymbols[];
};
