// routes/dashboard.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { pageMeta } from "../utils/page-meta.js";

const router = Router();

router.get("/dashboard", requireAuth, (req, res) => {
  const user = req.session?.user || req.user || null;

  return res.render(
    "dashboard/index",
    {
      ...pageMeta(req, {
        title: "Dashboard",
        description: "Members dashboard.",
        path: "/dashboard",
        ogType: "website",
        robots: "noindex, nofollow", // dashboard should not be indexed
      }),
      user,
    }
  );
});

export default router;
