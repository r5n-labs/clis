import type { Report } from "./report-data";
import { viewerAssets } from "./viewer-assets";

function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export async function htmlReport(report: Report): Promise<string> {
  const { script, style } = await viewerAssets();
  const nonce = crypto.randomUUID();
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${policy}">
  <title>Argus review</title>
  <style>${style.replaceAll("</style", "<\\/style")}</style>
</head>
<body>
  <div id="root"><p class="loading">Opening your Argus report…</p></div>
  <noscript>This report needs JavaScript to show its interactive results.</noscript>
  <script id="argus-report-data" type="application/json">${inlineJson(report)}</script>
  <script nonce="${nonce}">${script.replaceAll("</script", "<\\/script")}</script>
</body>
</html>`;
}
