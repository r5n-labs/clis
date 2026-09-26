const DEFAULT_INDENT = "  ";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonEntry = { key: string; start: number; node: JsonNode };
type JsonNode = { start: number; end: number; value: JsonValue; entries: JsonEntry[] };

export function updateJson(content: string, value: object): string {
  JSON.parse(content);
  const next: JsonValue = JSON.parse(JSON.stringify(value));
  const root = parseLayout(content);
  const indent = content.match(/^[\t ]+(?=\S)/m)?.[0] ?? DEFAULT_INDENT;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const inlineSpace =
    /\s/.test(content[root.start + 1] ?? "") ||
    root.entries.some((entry) => /:\s+$/.test(content.slice(entry.start, entry.node.start)))
      ? " "
      : "";

  function render(node: JsonNode, updated: JsonValue): string {
    const original = content.slice(node.start, node.end);
    if (JSON.stringify(node.value) === JSON.stringify(updated)) return original;

    const isArray = Array.isArray(updated);
    if (
      updated === null ||
      typeof updated !== "object" ||
      node.value === null ||
      typeof node.value !== "object" ||
      Array.isArray(node.value) !== isArray
    ) {
      return formatNew(updated, node.start, original.includes("\n"));
    }

    const keys = isArray
      ? updated.map((_, index) => String(index))
      : [
          ...new Set([
            ...node.entries.map((entry) => entry.key).filter((key) => Object.hasOwn(updated, key)),
            ...Object.keys(updated),
          ]),
        ];
    if (keys.length === 0) return isArray ? "[]" : "{}";

    const first = node.entries[0];
    const last = node.entries.at(-1);
    if (!first || !last) return formatNew(updated, node.start, original.includes("\n"));

    const valueAt = (key: string): JsonValue =>
      isArray ? (updated[Number(key)] as JsonValue) : (updated[key] as JsonValue);

    if (keys.length === node.entries.length && keys.every((key, index) => key === node.entries[index]?.key)) {
      let cursor = node.start;
      let result = "";
      for (const entry of node.entries) {
        result += content.slice(cursor, entry.node.start) + render(entry.node, valueAt(entry.key));
        cursor = entry.node.end;
      }
      return result + content.slice(cursor, node.end);
    }

    const leading = content.slice(node.start + 1, first.start);
    const trailing = content.slice(last.node.end, node.end - 1);
    const second = node.entries[1];
    const separator = second
      ? content.slice(first.node.end, second.start)
      : `,${leading.includes("\n") ? leading : inlineSpace}`;
    const colon = isArray ? "" : (content.slice(first.start, first.node.start).match(/:\s*$/)?.[0] ?? ": ");
    const entries = new Map(node.entries.map((entry) => [entry.key, entry]));
    const values = keys.map((key) => {
      const entry = entries.get(key);
      if (entry) return content.slice(entry.start, entry.node.start) + render(entry.node, valueAt(key));
      const prefix = isArray ? "" : JSON.stringify(key) + colon;
      return prefix + formatNew(valueAt(key), first.start, leading.includes("\n"));
    });

    return `${isArray ? "[" : "{"}${leading}${values.join(separator)}${trailing}${isArray ? "]" : "}"}`;
  }

  function formatNew(updated: JsonValue, position: number, multiline: boolean): string {
    if (!multiline) return formatInline(updated, inlineSpace);
    const lineStart = content.lastIndexOf("\n", position - 1) + 1;
    const prefix = content.slice(lineStart, position).match(/^[\t ]*/)?.[0] ?? "";
    return JSON.stringify(updated, null, indent).replaceAll("\n", newline + prefix);
  }

  return content.slice(0, root.start) + render(root, next) + content.slice(root.end);
}

function formatInline(value: JsonValue, space: string): string {
  if (Array.isArray(value)) return `[${value.map((item) => formatInline(item, space)).join(`,${space}`)}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const properties = entries.map(([key, item]) => `${JSON.stringify(key)}:${space}${formatInline(item, space)}`);
  return `{${space}${properties.join(`,${space}`)}${space}}`;
}

function parseLayout(content: string): JsonNode {
  const tokens = content.matchAll(/"(?:[^"\\]|\\.)*"|[^\s{}[\],:]+|[{}[\],:]/g);
  let token = tokens.next().value;

  function take(): RegExpExecArray {
    if (!token) throw new Error("Unexpected end of JSON");
    const current = token;
    token = tokens.next().value;
    return current;
  }

  function parseNode(): JsonNode {
    const start = take();
    const entries: JsonEntry[] = [];
    const isObject = start[0] === "{";
    if (!isObject && start[0] !== "[") {
      return { end: start.index + start[0].length, entries, start: start.index, value: JSON.parse(start[0]) };
    }

    const closing = isObject ? "}" : "]";
    while (token && token[0] !== closing) {
      const entryStart = token.index;
      const key: string = isObject ? JSON.parse(take()[0]) : String(entries.length);
      if (isObject) take();
      entries.push({ key, node: parseNode(), start: entryStart });
      if (token?.[0] === ",") take();
    }
    const end = take().index + 1;
    return { end, entries, start: start.index, value: JSON.parse(content.slice(start.index, end)) };
  }

  return parseNode();
}
