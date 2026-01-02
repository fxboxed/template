// routes/static.routes.js
import { Router } from "express";
import { pageMeta } from "../utils/page-meta.js";

const router = Router();

router.get("/games/game1", (req, res) => {
  return res.render(
    "games/game1",
    pageMeta(req, {
      title: "Game 1",
      description: "Play Game 1. Fast, simple, and shareable.",
      path: "/games/game1",
      // ogImagePath: "/images/og/game1.jpg", // add later when you have it
      ogType: "website",
    })
  );
});

router.get("/games/game2", (req, res) => {
  return res.render(
    "games/game2",
    pageMeta(req, {
      title: "Game 2",
      description: "Play Game 2. A quick daily challenge you can share.",
      path: "/games/game2",
      // ogImagePath: "/images/og/game2.jpg",
      ogType: "website",
    })
  );
});

export default router;
