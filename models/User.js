// models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    email: { type: String, default: "", index: true },
    displayName: { type: String, default: "" },
    photo: { type: String, default: "" },

    createdAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date, default: Date.now },

    // Future: roles/prefs/stats
    roles: { type: [String], default: [] },
    prefs: { type: Object, default: {} },
  },
  { minimize: false }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
