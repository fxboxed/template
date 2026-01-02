// app.js

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

import requiredRoutes from "./routes/required.routes.js";
import staticRoutes from "./routes/static.routes.js";

import authRoutes from "./routes/auth.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";

import { pageMeta } from "./utils/page-meta.js";

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("❌ Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Check your .env file.");
  process.exit(1);
}

const app = express();

// ---- basics
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === "production";

// Trust proxy only in production (behind Cloudflare/Nginx)
if (isProd) app.set("trust proxy", 1);

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

// ---- middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- session cookie
app.use(
  session({
    name: "aptati_sid",
    secret: process.env.SESSION_SECRET || "change-me-in-prod",
    resave: false,
    saveUninitialized: false,
    proxy: isProd,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// ---- Passport: Google OAuth
const PORT = Number(process.env.PORT || 4000);
const baseUrl = String(process.env.BASE_URL || `http://localhost:${PORT}`).trim().replace(/\/+$/, "");

// Minimal passport session serialization (good for local dev)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: `${baseUrl}/auth/google/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile?.emails?.[0]?.value || "";
      const photo = profile?.photos?.[0]?.value || "";

      const user = {
        id: profile.id,
        displayName: profile.displayName || "",
        email,
        photo,
      };

      return done(null, user);
    }
  )
);

app.use(passport.initialize());
app.use(passport.session());

// ---- locals for views
app.use((req, res, next) => {
  const authed =
    Boolean(req.session?.userId) ||
    (typeof req.isAuthenticated === "function" && req.isAuthenticated());

  res.locals.isAuthed = authed;
  res.locals.user = req.session?.user || req.user || null;

  // ✅ Google Analytics Measurement ID (GA4). Leave blank to disable.
  res.locals.gaId = String(process.env.GA_MEASUREMENT_ID || "").trim();

  next();
});

// ---- routes
app.get("/", (req, res) => {
  return res.render(
    "index",
    pageMeta(req, {
      title: "Home",
      description: "A simple Node/Express template with Pug, sessions, Google login, and games.",
      path: "/",
      ogType: "website",
    })
  );
});

app.use("/", authRoutes);
app.use("/", dashboardRoutes);

app.use("/", requiredRoutes);
app.use("/", staticRoutes);

// ---- 404
app.use((req, res) => {
  return res.status(404).render("404", {
    ...pageMeta(req, {
      title: "404",
      description: "Page not found.",
      path: req.originalUrl || "/",
      ogType: "website",
      robots: "noindex, nofollow",
    }),
    url: req.originalUrl,
  });
});

// ---- error handler
app.use((err, req, res, next) => {
  console.error(err);
  return res.status(500).render("500", {
    ...pageMeta(req, {
      title: "Server error",
      description: "Something broke.",
      path: req.originalUrl || "/",
      ogType: "website",
      robots: "noindex, nofollow",
    }),
    message: isProd ? "Something broke." : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`✅ aptati running on http://localhost:${PORT}`);
});
