import type { Token, TokenStream } from "prismjs";
import type { ReactNode } from "react";
import { Prism } from "./languages";
import "prismjs/components/prism-tsx";

const LANGUAGES: Record<string, string> = {
  gd: "gdscript",
  tscn: "godot",
  tres: "godot",
  godot: "godot",
  po: "gettext",
  pot: "gettext",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  jsonc: "javascript",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  py: "python",
  php: "php",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  diff: "diff",
  patch: "diff",
};

export function sourceLanguage(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? "plain";
}

export function highlightSource(source: string, language: string): ReactNode {
  const grammar = Prism.languages[language];
  if (!grammar) return source;
  return renderTokens(Prism.tokenize(source, grammar));
}

function renderTokens(stream: TokenStream): ReactNode {
  if (typeof stream === "string") return stream;
  if (!Array.isArray(stream)) return <span className={tokenClasses(stream)}>{renderTokens(stream.content)}</span>;
  let position = 0;
  return stream.map((token) => {
    const key = position;
    position += tokenLength(token);
    return typeof token === "string" ? (
      token
    ) : (
      <span className={tokenClasses(token)} key={key}>
        {renderTokens(token.content)}
      </span>
    );
  });
}

function tokenClasses(token: Token): string {
  const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
  return ["token", token.type, ...aliases].join(" ");
}

function tokenLength(stream: TokenStream): number {
  if (typeof stream === "string") return stream.length;
  if (!Array.isArray(stream)) return tokenLength(stream.content);
  return stream.reduce((length, token) => length + tokenLength(token), 0);
}
