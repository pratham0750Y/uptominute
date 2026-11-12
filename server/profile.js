// Per-user settings: colour theme and profile photo.
import { readJson } from "./auth.js";

export const THEMES = ["cyber", "olive", "ocean", "sunset", "graphite", "paper"];   // keep in step with client/style.css
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_AVATAR_CHARS = 300_000;                                                    // about 220 KB of image
const MAGIC = {
  jpeg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  webp: (b) => b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
};

async function body(req, res, json, limit) {
  if (!(req.headers["content-type"] || "").includes("application/json")) { json(res, 415, { error: "bad_request", message: "Send JSON" }); return null; }
  try { return await readJson(req, limit); }
  catch (e) { json(res, e.status || 400, { error: "bad_request", message: e.status === 413 ? "That picture is too large." : e.message }); return null; }
}

export function createProfile(store) {
  return {
    async themeSet(req, res, json, user) {
      const b = await body(req, res, json, 2_000); if (!b) return;
      if (!THEMES.includes(b.theme)) return json(res, 400, { error: "bad_request", message: "Unknown theme." });
      await store.setTheme(user.id, b.theme);
      return json(res, 200, { theme: b.theme });
    },
    async avatarSet(req, res, json, user) {
      const b = await body(req, res, json, 400_000); if (!b) return;
      if (b.image === null) { await store.setAvatar(user.id, null); return json(res, 200, { avatarV: 0 }); }
      const img = typeof b.image === "string" ? b.image : "";
      const m = img.length <= MAX_AVATAR_CHARS ? img.match(AVATAR_RE) : null;
      if (!m) return json(res, 400, { error: "bad_request", message: "Please choose a JPEG, PNG or WebP picture." });
      if (!MAGIC[m[1]](Buffer.from(m[2], "base64"))) return json(res, 400, { error: "bad_request", message: "That file is not a valid picture." });
      return json(res, 200, { avatarV: await store.setAvatar(user.id, img) });
    },
    async avatarGet(res, user) {
      const a = await store.getAvatar(user.id);
      const m = a && a.match(AVATAR_RE);
      if (!m) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not_found"}'); }
      const buf = Buffer.from(m[2], "base64");
      res.writeHead(200, {
        "content-type": `image/${m[1]}`, "content-length": buf.length,
        "cache-control": "private, max-age=86400",           // the page adds ?v=<version>, so a new photo is fetched fresh
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'",
      });
      res.end(buf);
    },
  };
}
