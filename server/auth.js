// Password hashing, sessions, login rate limiting. Uses only Node's built-in crypto.
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
export const normUser = (s) => String(s ?? "").trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const checkPassword = (p) =>
  typeof p !== "string" || p.length < 8 ? "Password must be at least 8 characters."
  : p.length > 200 ? "Password is too long." : null;

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const key = await scryptAsync(pw, Buffer.from(s, "base64"), 64);
  const want = Buffer.from(h, "base64");
  return want.length === key.length && timingSafeEqual(key, want);
}

const SESSION_MS = 7 * 24 * 3600e3;
const WINDOW_MS = 10 * 60e3;
const sha = (t) => createHash("sha256").update(t).digest("hex");
const DUMMY_HASH = await hashPassword("placeholder-so-unknown-users-cost-the-same-time");

export async function readJson(req, limit = 10_000) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

export function createAuth(store) {
  const fails = new Map();      // key -> { n, first }
  const limited = (key, max, win = WINDOW_MS) => {
    const f = fails.get(key);
    if (!f) return false;
    if (Date.now() - f.first > win) { fails.delete(key); return false; }
    return f.n >= max;
  };
  const bump = (key, win = WINDOW_MS) => {
    const f = fails.get(key);
    if (!f || Date.now() - f.first > win) fails.set(key, { n: 1, first: Date.now() }); else f.n++;
  };
  const newSession = async (res, userId) => {
    const token = randomBytes(32).toString("base64url");
    await store.createSession(sha(token), userId, Date.now() + SESSION_MS);
    setCookie(res, token, SESSION_MS / 1000);
  };
  const jsonBody = async (req, res, json) => {
    if (!(req.headers["content-type"] || "").includes("application/json")) { json(res, 415, { error: "bad_request", message: "Send JSON" }); return null; }
    try { return await readJson(req); } catch (e) { json(res, e.status || 400, { error: "bad_request", message: e.message }); return null; }
  };
  const cookie = (req) => {
    const m = (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("sid="));
    return m ? decodeURIComponent(m.slice(4)) : null;
  };
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  const setCookie = (res, value, maxAge) =>
    res.setHeader("set-cookie", `sid=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);

  setInterval(() => store.purgeExpired(Date.now()).catch(() => {}), 3600e3).unref();
  store.purgeExpired(Date.now()).catch(() => {});

  return {
    async userFrom(req) {
      const t = cookie(req);
      if (!t) return null;
      try { return await store.getSession(sha(t), Date.now()); } catch (e) { console.error("session lookup failed:", e.message); return null; }
    },
    async login(req, res, json) {
      if (!(req.headers["content-type"] || "").includes("application/json"))
        return json(res, 415, { error: "bad_request", message: "Send JSON" });
      let body;
      try { body = await readJson(req); } catch (e) { return json(res, e.status || 400, { error: "bad_request", message: e.message }); }
      const username = normUser(body.username);
      const password = typeof body.password === "string" ? body.password.slice(0, 201) : "";
      const ip = req.socket.remoteAddress || "?", userKey = `${ip}|${username}`;
      if (limited(ip, 20) || limited(userKey, 5))
        return json(res, 429, { error: "too_many_attempts", message: "Too many failed attempts. Try again in 10 minutes." });
      const user = username.length <= 50 ? await store.getUserByName(username) : null;
      const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok || password.length > 200) {
        bump(ip); bump(userKey);
        return json(res, 401, { error: "invalid_login", message: "Wrong username or password" });
      }
      fails.delete(userKey);
      const token = randomBytes(32).toString("base64url");
      await store.createSession(sha(token), user.id, Date.now() + SESSION_MS);
      setCookie(res, token, SESSION_MS / 1000);
      return json(res, 200, { user: user.username });
    },
    async logout(req, res, json) {
      const t = cookie(req);
      if (t) await store.deleteSession(sha(t)).catch(() => {});
      setCookie(res, "", 0);
      return json(res, 200, { ok: true });
    },
    config: () => ({ signup: process.env.ALLOW_SIGNUP !== "0", needsCode: !!process.env.SIGNUP_CODE }),
    async signup(req, res, json) {
      if (process.env.ALLOW_SIGNUP === "0")
        return json(res, 403, { error: "signup_disabled", message: "Sign-up is turned off. Ask the person who runs this server for an account." });
      const body = await jsonBody(req, res, json); if (!body) return;
      const ip = req.socket.remoteAddress || "?", key = `signup|${ip}`;
      if (limited(key, 5, 3600e3)) return json(res, 429, { error: "too_many_attempts", message: "Too many sign-ups from this computer. Try again in an hour." });
      const want = process.env.SIGNUP_CODE;
      if (want && sha(String(body.code ?? "")) !== sha(want)) { bump(key, 3600e3); return json(res, 403, { error: "bad_code", message: "That invite code is wrong." }); }
      const username = normUser(body.username);
      if (!USERNAME_RE.test(username)) return json(res, 400, { error: "bad_request", message: "Username must be 3-30 characters: letters, numbers, dot, dash or underscore." });
      const problem = checkPassword(body.password);
      if (problem) return json(res, 400, { error: "bad_request", message: problem });
      bump(key, 3600e3);                      // typos in the form do not count; real attempts do
      if (!(await store.createUser(username, await hashPassword(body.password))))
        return json(res, 409, { error: "username_taken", message: "That username is already taken." });
      const user = await store.getUserByName(username);
      await newSession(res, user.id);
      return json(res, 200, { user: user.username });
    },
    async changePassword(req, res, json, me) {
      const body = await jsonBody(req, res, json); if (!body) return;
      const key = `pw|${me.username}`;
      if (limited(key, 5)) return json(res, 429, { error: "too_many_attempts", message: "Too many wrong attempts. Try again in 10 minutes." });
      const user = await store.getUserByName(me.username);
      const current = typeof body.current === "string" ? body.current.slice(0, 201) : "";
      if (!user || current.length > 200 || !(await verifyPassword(current, user.password_hash))) {
        bump(key);
        return json(res, 403, { error: "wrong_password", message: "Your current password is wrong." });
      }
      const problem = checkPassword(body.password);
      if (problem) return json(res, 400, { error: "bad_request", message: problem });
      await store.setPassword(user.username, await hashPassword(body.password));
      await store.deleteUserSessions(user.id);       // signs out every other device
      await newSession(res, user.id);                // keep this browser signed in
      fails.delete(key);
      return json(res, 200, { ok: true });
    },
  };
}
