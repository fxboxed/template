// routes/dashboard.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { pageMeta } from "../utils/page-meta.js";

const router = Router();

router.get("/dashboard", requireAuth, (req, res) => {
  // Prefer Mongo user loaded via passport.deserializeUser()
  const user = req.user || req.session?.user || null;

  return res.render("dashboard/index", {
    ...pageMeta(req, {
      title: "Dashboard",
      description: "Members dashboard.",
      path: "/dashboard",
      ogType: "website",
      robots: "noindex, nofollow",
    }),
    user,
  });
});

export default router;
