// routes/auth.routes.js
import { Router } from "express";
import passport from "passport";
import { pageMeta } from "../utils/page-meta.js";

const router = Router();

router.get("/login", (req, res) => {
  if (req.session?.userId || (typeof req.isAuthenticated === "function" && req.isAuthenticated())) {
    return res.redirect("/dashboard");
  }

  return res.render(
    "auth/login",
    pageMeta(req, {
      title: "Login",
      description: "Sign in with Google to access the members dashboard.",
      path: "/login",
      ogType: "website",
      robots: "noindex, nofollow",
    })
  );
});

router.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })
);

router.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: true,
  }),
  (req, res, next) => {
    // ✅ Ensure our own session markers are set
    req.session.userId = req.user?.id;
    req.session.user = req.user;

    // ✅ Critical: force session save before redirect (prevents “logged out after redirect/navigation”)
    req.session.save((err) => {
      if (err) return next(err);
      return res.redirect("/dashboard");
    });
  }
);

router.post("/logout", (req, res, next) => {
  if (typeof req.logout === "function") {
    req.logout((err) => {
      if (err) return next(err);

      req.session.destroy(() => {
        res.clearCookie("aptati_sid");
        return res.redirect("/");
      });
    });
  } else {
    req.session.destroy(() => {
      res.clearCookie("aptati_sid");
      return res.redirect("/");
    });
  }
});

export default router;
