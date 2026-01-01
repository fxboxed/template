// routes/static.routes.js
import { Router } from "express";

const router = Router();

router.get("/games/game1", (req, res) => {
  res.render("games/game1", { title: "Game 1" });
});

router.get("/games/game2", (req, res) => {
  res.render("games/game2", { title: "Game  2" });
});

export default router;
