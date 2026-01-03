// middleware/requireAuth.js
export function requireAuth(req, res, next) {
  const hasPassport = typeof req.isAuthenticated === "function" && req.isAuthenticated();
  const hasSession = Boolean(req.session?.userId);

  if (hasPassport && !hasSession && req.user?._id) {
    req.session.userId = String(req.user._id);
  }

  if (!hasSession && !hasPassport) return res.redirect("/login");
  return next();
}

