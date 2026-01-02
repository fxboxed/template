// middleware/requireAuth.js
export function requireAuth(req, res, next) {
  const authed =
    Boolean(req.session?.userId) || (typeof req.isAuthenticated === "function" && req.isAuthenticated());

  if (!authed) return res.redirect("/login");
  return next();
}
