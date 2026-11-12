import http from "node:http";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { openStore } from "./db.js";
import { createAuth } from "./auth.js";
import { createProfile } from "./profile.js";
import { createChat } from "./chat.js";
import { NEWS_FEEDS, TRAFFIC_FEEDS, EVENTS, CITY, BENGALURU_RADIO, KNOWN_CLOSURES, AREAS } from "./sources.js";

loadEnv();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";   // 0.0.0.0 = reachable from other computers on your network; use 127.0.0.1 to keep it private
const CLIENT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "client");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

// ---- tiny TTL cache: stale data is served if an upstream fails ----
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const v = await load();
    cache.set(key, { t: Date.now(), v });
    return v;
  } catch (err) {
    if (hit) return Array.isArray(hit.v) ? hit.v : { ...hit.v, stale: true };
    throw err;
  }
}
const get = (url) =>
  fetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "NammaBengaluruLive/1.0" } });

// ---- RSS ----
const clean = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
   .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

function parseRss(xml, fallbackSource) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([block]) => {
    const tag = (t) => { const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? clean(m[1]) : ""; };
    const d = new Date(tag("pubDate"));
    return { title: tag("title"), link: tag("link"), source: tag("source") || fallbackSource, time: isNaN(d) ? null : d.toISOString() };
  }).filter((i) => i.title && i.link);
}

async function collect(feeds) {
  const results = await Promise.allSettled(
    feeds.map(async (f) => parseRss(await (await get(f.url)).text(), f.name))
  );
  const seen = new Set();
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((i) => { const k = i.title.toLowerCase().slice(0, 60); return seen.has(k) ? false : seen.add(k); })
    .sort((a, b) => (b.time || "").localeCompare(a.time || ""))
    .slice(0, 40);
  if (!items.length) throw new Error("no feed responded");
  return { items, fetchedAt: new Date().toISOString(), feedsOk: results.filter((r) => r.status === "fulfilled").length };
}

// ---- weather + air quality (Open-Meteo, no key) ----
const WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 80: "Showers", 81: "Showers", 82: "Violent showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail" };
const rainLevel = (p) => (p >= 75 ? "Very likely" : p >= 50 ? "Likely" : p >= 20 ? "Possible" : "Unlikely");
function rainChance(w) {
  const probs = w.hourly?.precipitation_probability, times = w.hourly?.time;
  if (!probs || !times) return null;
  const now = (w.current.time || "").slice(0, 13);            // e.g. 2026-10-15T14
  let i = times.findIndex((t) => t.startsWith(now));
  if (i < 0) i = 0;
  const max = (n) => Math.max(...probs.slice(i, i + n).filter((x) => x != null), 0);
  const next3h = max(3), next6h = max(6), next24h = max(24);
  return { next3h, next6h, next24h, level: rainLevel(next6h), hourly: probs.slice(i, i + 6) };
}
const km = (a, b, c, d) => {            // haversine distance in km
  const r = (x) => (x * Math.PI) / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
function nearestArea(lat, lon) {
  const best = AREAS.reduce((x, y) => (km(lat, lon, y.lat, y.lon) < km(lat, lon, x.lat, x.lon) ? y : x));
  return { name: best.name, km: +km(lat, lon, best.lat, best.lon).toFixed(1) };
}
async function weatherAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 12.6 || lat > 13.4 || lon < 77.2 || lon > 78.0)
    throw Object.assign(new Error("Pick a spot inside Bengaluru"), { status: 400 });
  return cached(`weather:${lat.toFixed(2)},${lon.toFixed(2)}`, 10 * 60e3, () => weather(lat, lon));
}
async function weather(lat = CITY.lat, lon = CITY.lon) {
  const [w, a] = await Promise.all([
    get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&hourly=precipitation_probability&forecast_days=2&timezone=Asia%2FKolkata`).then((r) => r.json()),
    get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`).then((r) => r.json()).catch(() => null),
  ]);
  const c = w.current;
  const rain = rainChance(w);
  return {
    location: { lat, lon, area: nearestArea(lat, lon) },
    rain,
    tempC: c.temperature_2m, humidity: c.relative_humidity_2m, rainMm: c.precipitation, windKmh: c.wind_speed_10m,
    summary: WMO[c.weather_code] || "—", aqi: a?.current?.us_aqi ?? null, pm25: a?.current?.pm2_5 ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

// ---- Bengaluru radio: fixed station list, streams looked up in radio-browser.info ----
const DIRECTORY = "https://de1.api.radio-browser.info/json/stations/search";
async function findStream(st) {
  const hits = [];
  for (const term of st.match) {
    const url = `${DIRECTORY}?name=${encodeURIComponent(term)}&countrycode=IN&hidebroken=true&order=clickcount&reverse=true&limit=15`;
    hits.push(...(await (await get(url)).json()));
  }
  const ok = hits.filter((h) => (h.url_resolved || "").startsWith("http") && st.match.some((m) => h.name.toLowerCase().includes(m)));
  const bengaluru = ok.find((h) => /bangalore|bengaluru/i.test(`${h.name} ${h.tags} ${h.state}`));
  const karnataka = ok.find((h) => /karnataka/i.test(h.state || ""));
  const best = bengaluru || karnataka;           // never guess: a Mumbai or Delhi stream would be the wrong station
  return best ? best.url_resolved : null;
}
async function radio() {
  const stations = await Promise.all(BENGALURU_RADIO.map(async (st) => {
    let stream = null;
    try { stream = await findStream(st); } catch {}
    return { name: st.name, freq: st.freq, stream, site: st.site, tags: "FM · Bengaluru" };
  }));
  return { stations, source: "Bengaluru FM list, streams from radio-browser.info", fetchedAt: new Date().toISOString() };
}

// ---- place search + route suggestions (OpenStreetMap Nominatim + OSRM, no keys) ----
const trafficData = () => cached("traffic", 3 * 60e3, () => collect(TRAFFIC_FEEDS));

async function places(q) {
  q = (q || "").trim();
  if (q.length < 2) return [];
  return cached("geo:" + q.toLowerCase(), 24 * 3600e3, async () => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&viewbox=77.35,13.25,77.85,12.75&bounded=1&q=${encodeURIComponent(q)}`;
    const rows = await (await get(url)).json();
    return rows.map((r) => ({ name: r.display_name.split(",").slice(0, 3).join(",").trim(), lat: +r.lat, lon: +r.lon }));
  });
}
async function geocode(q) {
  const m = (q || "").match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (m) return { name: q, lat: +m[1], lon: +m[2] };
  const hits = await places(q);
  if (!hits.length) throw new Error(`Could not find "${q}" in Bengaluru`);
  return hits[0];
}
function isPeakIST() {
  const t = new Date(Date.now() + 5.5 * 3600e3), h = t.getUTCHours(), d = t.getUTCDay();
  return d > 0 && d < 6 && ((h >= 8 && h < 11) || (h >= 17 && h < 21));
}
async function suggestRoutes(fromQ, toQ) {
  const a = await geocode(fromQ);
  const b = await geocode(toQ);
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?alternatives=3&overview=full&geometries=geojson&steps=true`;
  const data = await (await get(url)).json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("No drivable route found between those places");
  let advisories = [];
  try { advisories = (await trafficData()).items; } catch {}
  const peak = isPeakIST();

  const routes = data.routes.map((r) => {
    const byRoad = new Map();
    for (const leg of r.legs) for (const s of leg.steps) if (s.name) byRoad.set(s.name, (byRoad.get(s.name) || 0) + s.distance);
    const roads = [...byRoad.keys()];
    const via = [...byRoad.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map((x) => x[0]);
    const warnings = [], seen = new Set();
    const add = (w) => { if (!seen.has(w.text)) { seen.add(w.text); warnings.push(w); } };
    for (const c of KNOWN_CLOSURES)
      if (roads.some((n) => n.toLowerCase().includes(c.road.toLowerCase())))
        add({ type: "closure", text: `${c.road} ${c.note} (until ${c.until})` });
    for (const it of advisories) {
      const hit = roads.find((n) => n.length >= 6 && it.title.toLowerCase().includes(n.toLowerCase()));
      if (hit) add({ type: "advisory", text: it.title, link: it.link });
    }
    const freeFlowMin = Math.round(r.duration / 60);
    return {
      km: +(r.distance / 1000).toFixed(1), freeFlowMin,
      etaMin: Math.round(freeFlowMin * (peak ? 1.8 : 1.25)),   // rough rule of thumb, not live traffic
      via, warnings: warnings.slice(0, 3), blocked: warnings.some((w) => w.type === "closure"),
      mapsUrl: `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}`,
      // [lat, lon] pairs for drawing on the map (OSRM gives [lon, lat]); 5 decimals is ~1 m
      coords: (r.geometry?.coordinates || []).map(([x, y]) => [+y.toFixed(5), +x.toFixed(5)]),
      labels: [], recommended: false,
    };
  });
  const minBy = (k) => routes.reduce((bi, r, i) => (r[k] < routes[bi][k] ? i : bi), 0);
  routes[minBy("freeFlowMin")].labels.push("Fastest");
  routes[minBy("km")].labels.push("Shortest");
  const clear = routes.filter((r) => !r.blocked && r.warnings.length === 0);
  const pool = clear.length ? clear : routes.filter((r) => !r.blocked).length ? routes.filter((r) => !r.blocked) : routes;
  const best = pool.reduce((x, y) => (y.freeFlowMin < x.freeFlowMin ? y : x));
  best.recommended = true;
  if (clear.length && clear.length < routes.length) best.labels.push("Avoids reported closures");
  routes.sort((x, y) => Number(y.recommended) - Number(x.recommended));
  return { from: a.name, to: b.name, peak, routes, fetchedAt: new Date().toISOString() };
}

// ---- routing ----
const API = {
  "/api/news": () => cached("news", 5 * 60e3, () => collect(NEWS_FEEDS)),
  "/api/traffic": () => trafficData(),
  "/api/events": async () => {
    const now = Date.now();
    return {
      checkedAt: new Date(now).toISOString(),
      items: EVENTS.filter((event) => new Date(event.startAt).getTime() > now
        && (!event.registrationDeadline || new Date(event.registrationDeadline).getTime() > now)),
    };
  },
  "/api/weather": () => cached("weather", 10 * 60e3, weather),
  "/api/radio": () => cached("radio", 60 * 60e3, radio),
  "/api/areas": async () => AREAS,
  "/api/health": async () => ({ ok: true, time: new Date().toISOString() }),
};
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const chat = createChat({
  getNews: () => API["/api/news"](),
  getEvents: () => API["/api/events"](),
  getTraffic: () => API["/api/traffic"](),
  getWeather: () => API["/api/weather"](),
  suggestRoutes,
});

// ---- accounts (MySQL) ----
let store;
try { store = await openStore(); }
catch (e) { console.error("\nCould not start: " + e.message + "\n"); process.exit(1); }
const auth = createAuth(store);
const profile = createProfile(store);
const PUBLIC = new Set(["/login.html", "/login.js", "/style.css", "/theme.js", "/api/health"]);

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const qs = new URL(req.url, "http://x").searchParams;
  if (path === "/api/login" && req.method === "POST") return auth.login(req, res, json);
  if (path === "/api/logout" && req.method === "POST") return auth.logout(req, res, json);
  if (path === "/api/signup" && req.method === "POST") return auth.signup(req, res, json);
  if (path === "/api/config") return json(res, 200, auth.config());
  const user = await auth.userFrom(req);
  if (path === "/api/me") return user ? json(res, 200, { user: user.username, theme: user.theme || "olive", avatarV: Number(user.avatar_v) || 0 }) : json(res, 401, { error: "unauthorized", message: "Please sign in" });
  if (!user && !PUBLIC.has(path)) {
    if (path.startsWith("/api/")) return json(res, 401, { error: "unauthorized", message: "Please sign in" });
    res.writeHead(302, { location: "/login.html" });
    return res.end();
  }
  if (path === "/api/chat/status" && req.method === "GET") return json(res, 200, chat.status());
  if (path === "/api/chat" && req.method === "POST") {
    if (!(req.headers["content-type"] || "").includes("application/json"))
      return json(res, 415, { error: "bad_request", message: "Send JSON" });
    return chat.handle(req, res, json, user);
  }
  if (user && path === "/login.html") { res.writeHead(302, { location: "/" }); return res.end(); }
  if (path === "/api/password" && req.method === "POST") return auth.changePassword(req, res, json, user);
  if (path === "/api/theme" && req.method === "POST") return profile.themeSet(req, res, json, user);
  if (path === "/api/avatar" && req.method === "POST") return profile.avatarSet(req, res, json, user);
  if (path === "/api/avatar") return profile.avatarGet(res, user);
  if (path === "/api/places" || path === "/api/route") {
    try {
      if (path === "/api/places") return json(res, 200, await places(qs.get("q")));
      if (!qs.get("from") || !qs.get("to")) return json(res, 400, { error: "bad_request", message: "from and to are required" });
      return json(res, 200, await suggestRoutes(qs.get("from"), qs.get("to")));
    } catch (err) { return json(res, 502, { error: "upstream_unavailable", message: err.message }); }
  }
  if (path === "/api/weather" && qs.get("lat") && qs.get("lon")) {
    try { return json(res, 200, await weatherAt(+qs.get("lat"), +qs.get("lon"))); }
    catch (err) { return json(res, err.status || 502, { error: err.status ? "bad_request" : "upstream_unavailable", message: err.message }); }
  }
  if (API[path]) {
    try { return json(res, 200, await API[path]()); }
    catch (err) { return json(res, 502, { error: "upstream_unavailable", message: err.message }); }
  }
  const file = normalize(join(CLIENT, path === "/" ? "index.html" : path));
  if (!file.startsWith(CLIENT)) return json(res, 403, { error: "forbidden" });
  let body;
  try { body = await readFile(file); } catch { return json(res, 404, { error: "not_found" }); }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(body);
}).listen(PORT, HOST, () => {
  console.log(`Namma Bengaluru Live is running.\n  On this computer:  http://localhost:${PORT}`);
  if (HOST === "127.0.0.1" || HOST === "localhost") return console.log("  Network access is off (HOST is set to local only).");
  const lan = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal);
  if (!lan.length) console.log("  No network address found. Check that this computer is connected.");
  lan.forEach((n) => console.log(`  On your network:   http://${n.address}:${PORT}   <- share this with other computers`));
});
