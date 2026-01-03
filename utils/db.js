// utils/db.js
import mongoose from "mongoose";

let isConnected = false;

function buildMongoUri() {
  const uri = String(process.env.MONGODB_URI || "").trim();
  // If user provided a real URI, use it.
  if (uri && uri.startsWith("mongodb")) return uri;

  const host = String(process.env.MONGO_HOST || "127.0.0.1").trim();
  const port = String(process.env.MONGO_PORT || "27017").trim();
  const db = String(process.env.MONGO_DB || "aptati").trim();

  return `mongodb://${host}:${port}/${db}`;
}

export async function connectDB() {
  if (isConnected) return mongoose.connection;

  const uri = buildMongoUri();
  console.log("🔌 Connecting to Mongo:", uri);

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== "production",
  });

  isConnected = true;

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    console.warn("⚠️ MongoDB disconnected");
  });

  console.log("✅ MongoDB connected");
  return mongoose.connection;
}

export function mongoStatus() {
  return mongoose.connection?.readyState ?? 0;
}
