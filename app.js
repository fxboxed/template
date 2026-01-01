// app.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";

import requiredRoutes from "./routes/required.routes.js";
import staticRoutes from "./routes/static.routes.js";

const app = express();

// ---- basics
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1); // Cloudflare/Nginx friendly
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

// ---- middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- session cookie
app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "change-me-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // requires HTTPS
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ---- routes
app.get("/", (req, res) => {
  res.render("index", { title: "Home" });
});

app.use("/", requiredRoutes);
app.use("/", staticRoutes);

// ---- 404
app.use((req, res) => {
  return res.status(404).render("404", {
    title: "404",
    url: req.originalUrl,
  });
});

// ✅ error handler must come after 404
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("500", { title: "Server error", message: err.message });
});

// ---- error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("500", {
    title: "Server error",
    message:
      process.env.NODE_ENV === "production" ? "Something broke." : err.message,
  });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
