// routes/required.js
import { Router } from "express";

const router = Router();

// Static required pages
router.get("/required/about", (req, res) => res.render("required/about", { title: "About" }));
router.get("/required/terms", (req, res) => res.render("required/terms", { title: "Terms" }));
router.get("/required/privacy", (req, res) => res.render("required/privacy", { title: "Privacy" }));
router.get("/required/cookies", (req, res) => res.render("required/cookies", { title: "Cookies" }));

export default router;

