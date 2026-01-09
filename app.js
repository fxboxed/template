// app.js (ESM)

import "dotenv/config";

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

// Mongo
import { connectDB, mongoStatus } from "./utils/db.js";
import User from "./models/User.js";

// Daily Word API (Wordle-style)
import wordleApi from "./routes/api/wordle.js";
import { getDayKeyUTC } from "./server/games/wordle/puzzle.js";

const app = express();

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("❌ Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Check your .env file.");
  process.exit(1);
}

// ---- basics
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === "production";
if (isProd) app.set("trust proxy", 1);

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

// ---- middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ API mount (canonical only)
app.use("/api/games/daily-word", wordleApi);

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
const baseUrl = String(process.env.BASE_URL || `http://localhost:${PORT}`)
  .trim()
  .replace(/\/+$/, "");

// Store only Mongo user id in session
passport.serializeUser((user, done) => {
  try {
    return done(null, user?._id?.toString());
  } catch (e) {
    return done(e);
  }
});

passport.deserializeUser(async (id, done) => {
  try {
    if (!id) return done(null, null);
    const user = await User.findById(id).lean();
    return done(null, user || null);
  } catch (e) {
    return done(e);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: `${baseUrl}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = String(profile?.id || "").trim();
        if (!googleId) return done(new Error("Missing Google profile id"));

        const email = profile?.emails?.[0]?.value || "";
        const photo = profile?.photos?.[0]?.value || "";
        const displayName = profile?.displayName || "";

        let user = await User.findOne({ googleId });

        if (!user) {
          user = await User.create({
            googleId,
            email,
            photo,
            displayName,
            createdAt: new Date(),
            lastLoginAt: new Date(),
          });
        } else {
          user.email = email || user.email;
          user.photo = photo || user.photo;
          user.displayName = displayName || user.displayName;
          user.lastLoginAt = new Date();
          await user.save();
        }

        return done(null, user);
      } catch (err) {
        if (err && err.code === 11000) {
          try {
            const googleId = String(profile?.id || "").trim();
            const user = await User.findOne({ googleId });
            return done(null, user || null);
          } catch (e2) {
            return done(e2);
          }
        }
        return done(err);
      }
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
  res.locals.user = req.user || null;

  // Default brand
  res.locals.siteName = "Aptati Arcade";

  // GA id (layout handles consent stub only)
  res.locals.gaId = String(process.env.GA_MEASUREMENT_ID || "").trim();

  next();
});

// ✅ Debug: who am I?
app.get("/me", (req, res) => {
  const authed = typeof req.isAuthenticated === "function" && req.isAuthenticated();
  return res.json({
    authed,
    sessionUserId: req.session?.userId || null,
    user: req.user || null,
  });
});

// ---- health: db
app.get("/health/db", (req, res) => {
  const state = mongoStatus();
  const map = ["disconnected", "connected", "connecting", "disconnecting"];
  return res.status(state === 1 ? 200 : 503).json({
    ok: state === 1,
    mongoReadyState: state,
    mongoState: map[state] || "unknown",
  });
});

// ---- routes

// Home
app.get("/", (req, res) => {
  return res.render(
    "index",
    pageMeta(req, {
      siteName: "Aptati Arcade",
      title: "Aptati Arcade",
      description: "Snack-size games and daily puzzles on Aptati Arcade.",
      path: "/",
      canonicalPath: "/",
      ogType: "website",
      ogImage: "/images/og/index-og_1200x675.webp",
      twitterImage: "/images/og/index-og_1200x675.webp",
      ogWidth: 1200,
      ogHeight: 675,
    })
  );
});

// ✅ Canonical Daily Word route
app.get("/games/daily-word", (req, res) => {
  const dayKey = getDayKeyUTC(new Date());

  return res.render(
    "games/daily-word",
    pageMeta(
      req,
      {
        siteName: "Aptati Arcade",
        title: "Daily Word",
        description: "Guess today’s 5-letter word on Aptati Arcade.",
        path: "/games/daily-word",
        canonicalPath: "/games/daily-word",
        ogType: "website",
        ogImage: "/images/og/daily-word-og_1200x675.webp",
        twitterImage: "/images/og/daily-word-og_1200x675.webp",
        ogWidth: 1200,
        ogHeight: 675,
      },
      { dayKey }
    )
  );
});

// ✅ You want ONE URL only.
// Hard-stop legacy URLs BEFORE other route files can touch them.
// app.get("/games/game1", (req, res) => {
//   return res.status(404).render("404", {
//     ...pageMeta(req, {
//       siteName: "Aptati Arcade",
//       title: "404",
//       description: "Page not found.",
//       path: "/games/game1",
//       ogType: "website",
//       robots: "noindex, nofollow",
//     }),
//     url: req.originalUrl,
//   });
// });

// app.get("/games/wordle", (req, res) => {
//   return res.status(404).render("404", {
//     ...pageMeta(req, {
//       siteName: "Aptati Arcade",
//       title: "404",
//       description: "Page not found.",
//       path: "/games/wordle",
//       ogType: "website",
//       robots: "noindex, nofollow",
//     }),
//     url: req.originalUrl,
//   });
// });

app.use("/", authRoutes);
app.use("/", dashboardRoutes);

app.use("/", requiredRoutes);
app.use("/", staticRoutes);

// ---- 404
app.use((req, res) => {
  return res.status(404).render("404", {
    ...pageMeta(req, {
      siteName: "Aptati Arcade",
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
      siteName: "Aptati Arcade",
      title: "Server error",
      description: "Something broke.",
      path: req.originalUrl || "/",
      ogType: "website",
      robots: "noindex, nofollow",
    }),
    message: isProd ? "Something broke." : err.message,
  });
});

// ---- start
async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err.message);
    if (isProd) process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✅ aptati running on http://localhost:${PORT}`);
  });
}

start();

export default app;
