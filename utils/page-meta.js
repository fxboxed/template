// utils/page-meta.js (ESM)
// Generates consistent SEO + OG + Twitter locals for views/layout.pug

function stripTrailingSlashes(s) {
  return String(s || "").replace(/\/+$/, "");
}

function ensureLeadingSlash(p) {
  const s = String(p || "");
  if (!s) return "/";
  return s.startsWith("/") ? s : `/${s}`;
}

function absoluteUrl(baseUrl, pathOrUrl) {
  const v = String(pathOrUrl || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;

  const b = stripTrailingSlashes(String(baseUrl || "").trim());
  const p = ensureLeadingSlash(v);
  return b ? `${b}${p}` : p;
}

function firstCsvValue(v) {
  // x-forwarded-proto can be "https,http"
  return String(v || "").split(",")[0].trim();
}

function inferBaseUrl(req) {
  // Prefer BASE_URL, else infer from request (works in dev and prod)
  const envBase = stripTrailingSlashes(String(process.env.BASE_URL || "").trim());
  if (envBase) return envBase;

  const xfProto = firstCsvValue(req?.headers?.["x-forwarded-proto"]);
  const xfHost = firstCsvValue(req?.headers?.["x-forwarded-host"]);

  const proto = xfProto || req?.protocol || "http";
  const host = xfHost || req?.headers?.host || "localhost";

  return stripTrailingSlashes(`${proto}://${host}`);
}

/**
 * pageMeta(req, meta, extra)
 * meta: {
 *   title, description,
 *   path,               // path for current route, e.g. "/games/game1"
 *   canonical,          // absolute or path, overrides canonicalPath/path
 *   canonicalPath,      // path, used to force canonical/og:url (e.g. "/games/wordle")
 *   ogType, ogImage,
 *   twitterCard, twitterImage,
 *   robots, siteName
 * }
 */
export function pageMeta(req, meta = {}, extra = {}) {
  const baseUrl = inferBaseUrl(req);

  const siteName = String(meta.siteName || process.env.SITE_NAME || "aptati").trim();

  const requestPath = meta.path
    ? ensureLeadingSlash(meta.path)
    : (req?.path ? ensureLeadingSlash(req.path) : "/");

  const canonicalPath = meta.canonicalPath
    ? ensureLeadingSlash(meta.canonicalPath)
    : requestPath;

  const canonical = meta.canonical
    ? absoluteUrl(baseUrl, meta.canonical)
    : absoluteUrl(baseUrl, canonicalPath);

  // Prefer explicit per-page ogImage; else allow DEFAULT_OG_IMAGE; else empty
  const defaultOgImage = process.env.DEFAULT_OG_IMAGE
    ? absoluteUrl(baseUrl, String(process.env.DEFAULT_OG_IMAGE).trim())
    : "";

  const ogImage = meta.ogImage ? absoluteUrl(baseUrl, meta.ogImage) : "";
  const twitterImage =
    meta.twitterImage
      ? absoluteUrl(baseUrl, meta.twitterImage)
      : (ogImage || defaultOgImage);

  return {
    // Core SEO
    title: String(meta.title || "Site"),
    description: String(meta.description || "Static Node site"),
    canonical,

    // Open Graph
    siteName,
    ogType: String(meta.ogType || "website"),
    ogImage,          // if empty, layout falls back to defaultOgImage
    defaultOgImage,

    // Twitter
    twitterCard: String(meta.twitterCard || "summary_large_image"),
    twitterImage,

    // Robots
    robots: meta.robots ? String(meta.robots) : "",

    // Debug/helpful
    baseUrl,
    path: requestPath,

    // passthrough extras
    ...extra,
  };
}
