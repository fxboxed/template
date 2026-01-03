// utils/page-meta.js (ESM)

function stripTrailingSlashes(s) {
  return String(s || "").replace(/\/+$/, "");
}

function ensureLeadingSlash(s) {
  const v = String(s || "");
  if (!v) return "/";
  return v.startsWith("/") ? v : `/${v}`;
}

function getBaseUrl(req) {
  const envBase = String(process.env.BASE_URL || "").trim();
  if (envBase) return stripTrailingSlashes(envBase);

  const xfProto = req.headers["x-forwarded-proto"];
  const proto = (xfProto && String(xfProto).split(",")[0].trim()) || req.protocol || "http";
  const host = (req.get && req.get("host")) || req.headers.host || "localhost";
  return stripTrailingSlashes(`${proto}://${host}`);
}

export function pageMeta(req, meta = {}, extra = {}) {
  const siteName = String(meta.siteName || process.env.SITE_NAME || "Site").trim();

  const baseUrl = getBaseUrl(req);
  const path =
    meta.path != null ? ensureLeadingSlash(meta.path) : ensureLeadingSlash(req.originalUrl || "/");

  const canonical = meta.canonical ? String(meta.canonical).trim() : `${baseUrl}${path}`;

  const titleRaw = String(meta.title || "").trim();
  const title = titleRaw ? `${titleRaw} | ${siteName}` : siteName;

  const description = String(meta.description || "").trim() || "Static Node site";

  const ogType = String(meta.ogType || "website").trim();

  const defaultOgImage = meta.defaultOgImage ? String(meta.defaultOgImage).trim() : "";
  const ogImage = meta.ogImage ? String(meta.ogImage).trim() : "";

  const twitterImage = meta.twitterImage ? String(meta.twitterImage).trim() : (ogImage || "");
  const twitterCard = String(
    meta.twitterCard || (twitterImage ? "summary_large_image" : "summary")
  ).trim();

  const twitterSite = String(meta.twitterSite || "").trim();
  const twitterCreator = String(meta.twitterCreator || "").trim();

  const robots = String(meta.robots || "").trim();

  return {
    title,
    description,
    canonical,
    siteName,
    ogType,
    ogImage,
    defaultOgImage,
    twitterCard,
    twitterImage,
    twitterSite,
    twitterCreator,
    robots,
    ...(extra || {}),
  };
}
