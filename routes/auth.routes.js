// routes/auth.routes.js
import { Router } from "express";
import passport from "passport";
import { pageMeta } from "../utils/page-meta.js";

const router = Router();

function safeUser(u) {
  if (!u) return null;
  return {
    id: u._id ? String(u._id) : "",
    googleId: u.googleId || "",
    displayName: u.displayName || "",
    email: u.email || "",
    photo: u.photo || "",
  };
}

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
    // ✅ Our own session markers (Mongo user)
    req.session.userId = req.user?._id ? String(req.user._id) : "";
    req.session.user = safeUser(req.user);

    // ✅ Force session save before redirect
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

