/**
 * Tiny Swagger UI shell. Loads `swagger-ui-dist` from a public CDN — keeping
 * `swagger-ui-dist` out of the package's peer dependencies (zero footprint).
 *
 * Operators who want to self-host the assets can override `cdnBase` to point
 * at their own copy (e.g. served from `public/`). For air-gapped deploys,
 * vendor `swagger-ui.css`, `swagger-ui-bundle.js` and `swagger-ui-standalone-preset.js`.
 */

const DEFAULT_CDN = 'https://unpkg.com/swagger-ui-dist@5/'

export interface SwaggerOptions {
  cdnBase?: string
  title?: string
}

export function renderSwaggerHtml(specUrl: string, options: SwaggerOptions = {}): string {
  const cdn = options.cdnBase ?? DEFAULT_CDN
  const title = options.title ?? 'Lasagna Multitenancy Admin API'
  // We HTML-escape `specUrl` defensively — the operator passes it but it
  // ends up as a JS string literal too. A single `'`/`<` would be enough
  // for trouble.
  const safeSpec = specUrl
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${cdn}swagger-ui.css">
<style>body { margin: 0; padding: 0; }</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="${cdn}swagger-ui-bundle.js" crossorigin></script>
<script src="${cdn}swagger-ui-standalone-preset.js" crossorigin></script>
<script>
window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    url: '${safeSpec}',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset.slice(1)],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: 'StandaloneLayout',
  });
});
</script>
</body>
</html>`
}
