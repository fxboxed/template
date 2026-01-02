// utils/page-meta.js
export function getBaseUrl(req) {
  const envBase = (process.env.BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  const protoRaw = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const hostRaw = (req.headers["x-forwarded-host"] || req.get("host") || "").toString();

  const proto = protoRaw.split(",")[0].trim();
  const host = hostRaw.split(",")[0].trim();

  return `${proto}://${host}`.replace(/\/+$/, "");
}

export function pageMeta(req, opts = {}) {
  const {
    title = "Site",
    description = "Static Node site",
    path = "/",
    ogType = "website",
    ogImagePath = "", // e.g. "/images/og/game1.jpg"
    robots = "",
  } = opts;

  const baseUrl = getBaseUrl(req);
  const canonical = `${baseUrl}${path}`;

  const siteName = (process.env.SITE_NAME || "Site").trim();
  const defaultOgPath = (process.env.DEFAULT_OG_IMAGE || "/images/og/home.jpg").trim();

  const defaultOgImage = `${baseUrl}${defaultOgPath.startsWith("/") ? defaultOgPath : `/${defaultOgPath}`}`;

  const ogImage = ogImagePath
    ? `${baseUrl}${ogImagePath.startsWith("/") ? ogImagePath : `/${ogImagePath}`}`
    : "";

  return {
    title,
    description,
    canonical,
    siteName,
    ogType,
    ogImage,          // if blank, layout.pug will fall back to defaultOgImage
    defaultOgImage,
    twitterCard: "summary_large_image",
    robots,
  };
}
