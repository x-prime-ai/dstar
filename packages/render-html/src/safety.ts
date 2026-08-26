import { validatePackagePath } from "@dstar/core";

const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const FORBIDDEN_HTML = [
  /<script\b/iu,
  /<form\b/iu,
  /<iframe\b/iu,
  /<object\b/iu,
  /<embed\b/iu,
  /<base\b/iu,
  /<[^>]+\son[a-z]+\s*=/iu,
  /(?:href|src)\s*=\s*["']\s*(?:javascript|vbscript)\s*:/iu,
  /<svg\b/iu,
];

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

export function safeLink(href: string): string | undefined {
  const packagePath = validatePackagePath(href);
  if (packagePath.valid) return href;
  try {
    const url = new URL(href);
    return SAFE_LINK_SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function assertSafeGeneratedHtml(html: string): void {
  for (const forbidden of FORBIDDEN_HTML) {
    if (forbidden.test(html))
      throw new Error(
        `Generated HTML failed the active-content allowlist: ${forbidden.source}`,
      );
  }
}

/** Treat arbitrary HTML as text. Canonical content is never parsed as markup. */
export function sanitizeUntrustedHtml(value: string): string {
  return escapeHtml(value);
}

export const READER_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
].join("; ");
