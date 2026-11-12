// Client: renders what the server's /api/* endpoints return. No third-party calls from the browser.
const TABS = ["Now", "News", "Traffic", "Events", "Radio", "Weather", "Account"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "Now";

// ---- state (declared up top: views read it before the module finishes loading) ----
let loc = (() => { try { return JSON.parse(localStorage.getItem("blr-loc")); } catch { return null; } })();
const wxPath = (l = loc) => (l ? `/api/weather?lat=${l.lat}&lon=${l.lon}` : "/api/weather");
let map = null, pin = null, leafletReady = null, areasList = [];
let routeMapReady = null, routeMapHandle = null;   // React route-map widget (see route-map/)
const picked = new Map();   // suggestion label -> "lat,lon"
let displayedEvents = [];

const st = document.createElement("style");
st.textContent = `select{font:300 15px Jost,system-ui,sans-serif;padding:10px 12px;border:1px solid var(--line);border-radius:0;background:var(--input);color:var(--ink);flex:1 1 180px}
#map{background:var(--bg-deep)}.leaflet-tile-pane{filter:var(--map-filter)}
.leaflet-container{font-family:Jost,system-ui,sans-serif}.leaflet-control-attribution{background:var(--bg-deep)!important;color:var(--mute)!important}`;
document.head.append(st);

async function api(path) {
  const res = await fetch(path);
  if (res.status === 401) { location.href = "/login.html"; throw new Error("Please sign in"); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.statusText);
  return res.json();
}
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const newsCard = (i) => `<a class="card" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer"><span class="tag">${esc(i.source)} · ${ago(i.time)}</span><b style="font-size:15px">${esc(i.title)}</b></a>`;
const newsRow = (i) => `<a class="headline-row" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer"><span><b>${esc(i.title)}</b><small>${esc(i.source)}</small></span><time>${ago(i.time)}</time></a>`;
const eventOrigin = () => (loc && Number.isFinite(+loc.lat) && Number.isFinite(+loc.lon)) ? loc : { lat: 12.9716, lon: 77.5946 };
const eventDistance = (e) => {
  const o = eventOrigin(), rad = (v) => v * Math.PI / 180;
  const dLat = rad(e.lat - o.lat), dLon = rad(e.lon - o.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(o.lat)) * Math.cos(rad(e.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};
const eventDate = (e) => {
  const opts = { day: "numeric", month: "short", timeZone: "Asia/Kolkata" };
  const from = new Date(e.startAt).toLocaleDateString("en-IN", opts), to = new Date(e.endAt).toLocaleDateString("en-IN", opts);
  return from === to ? from : `${from} – ${to}`;
};
const eventCard = (e) => `<article class="event-card"><div class="event-date"><b>${new Date(e.startAt).toLocaleDateString("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" })}</b><span>${new Date(e.startAt).toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" })}</span></div><div class="event-info"><span class="tag">${esc(e.category)} · ${eventDistance(e)} km away</span><h3>${esc(e.title)}</h3><p>${eventDate(e)} · ${esc(e.area)} · ${esc(e.venue)}</p><small>${esc(e.registrationNote || e.price || "Check registration availability")}</small></div><a class="event-register" href="${esc(e.registration)}" target="_blank" rel="noopener noreferrer">${esc(e.registrationLabel)} ↗</a></article>`;
const sortedEvents = (items, sort) => [...items].sort((a, b) => sort === "soonest"
  ? new Date(a.startAt) - new Date(b.startAt)
  : eventDistance(a) - eventDistance(b) || new Date(a.startAt) - new Date(b.startAt));
const fail = (e) => `<div class="panel err">Server could not reach its source: ${esc(e.message)}. It retries automatically.</div>`;
const setNote = (t) => ($("note").textContent = t);

const weatherCards = (w) => `
  <div class="card"><span class="tag">Temperature</span><div class="stat">${w.tempC}°C</div><small>${esc(w.summary)}</small></div>
  <div class="card"><span class="tag">Air quality (US AQI)</span><div class="stat">${w.aqi ?? "—"}</div><small>PM2.5 ${w.pm25 ?? "—"} µg/m³</small></div>
  ${w.rain ? `<div class="card"><span class="tag">Chance of rain · ${esc(w.rain.level)}</span><div class="stat">${w.rain.next6h}%</div><small>Next 3 h ${w.rain.next3h}% · next 24 h ${w.rain.next24h}%</small></div>` : ""}
  <div class="card"><span class="tag">Humidity / rain now</span><div class="stat">${w.humidity}%</div><small>${w.rainMm} mm now</small></div>
  <div class="card"><span class="tag">Wind</span><div class="stat">${w.windKmh}</div><small>km/h</small></div>`;

const views = {
  async Now() {
    setNote("A Bengaluru dashboard project · Weather and headlines come from external sources; route times are estimates, not live congestion data.");
    const [t, n, w, ev] = await Promise.allSettled([api("/api/traffic"), api("/api/news"), api(wxPath()), api("/api/events")]);
    const sectionHead = (x, link, label, count = "") => `<div class="home-section-title"><div><h2>${x}</h2>${count ? `<span class="home-count">${count}</span>` : ""}</div><button class="text-link" data-home-tab="${link}">${label}</button></div>`;
    const nav = [
      ["Weather", "Weather", "Local weather", "Check conditions by area or choose a spot on the map."],
      ["Traffic", "Traffic headlines", "Route estimates and road advisories from headlines."],
      ["News", "Bengaluru news", "A quick read of stories gathered from news feeds."],
      ["Events", "Upcoming events", "Find events around Bengaluru and register with organizers."],
      ["Radio", "Local radio", "Browse Bengaluru stations and play available streams."],
    ];
    return `<section class="welcome">
        <div class="welcome-copy"><span class="tag">Your city, at a glance</span><h2>A little closer to Bengaluru.</h2>
          <p>Namma Bengaluru Live brings local events, weather, news, traffic headlines, route estimates and radio into one simple dashboard.</p>
          <p class="welcome-note">A project preview: route times are estimates and do not include live road congestion. Some information depends on external sources.</p>
          <button class="go" data-home-tab="Weather">Explore the dashboard</button>
        </div>
        <div class="feature-grid">${nav.map(([tab, title, desc]) => `<button class="feature-card" data-home-tab="${tab}"><span class="feature-mark" aria-hidden="true">${({Weather:"☼",Traffic:"↗",News:"▤",Events:"▦",Radio:"♫"})[tab] || ""}</span><span><b>${title}</b><small>${desc}</small></span><span class="feature-arrow" aria-hidden="true">→</span></button>`).join("")}</div>
      </section>
      <div class="home-section-title snapshot-title"><h2>Today in Bengaluru</h2><span class="section-caption">A quick snapshot</span></div>
      <div class="home-dashboard">
        <section class="home-weather-section">${sectionHead("Weather & air", "Weather", "More weather →")}
          <div class="home-weather-grid">${w.status === "fulfilled" ? weatherCards(w.value) : `<div class="panel empty">Weather is temporarily unavailable.</div>`}</div>
        </section>
        <div class="home-headline-sections">
          <section class="home-feed-section">${sectionHead("Traffic headlines", "Traffic", "View all →", t.status === "fulfilled" ? `${t.value.items.length} updates` : "")}
            <div class="home-rows">${t.status === "fulfilled" ? (t.value.items.length ? t.value.items.slice(0, 3).map(newsRow).join("") : `<div class="empty">No traffic headlines available right now.</div>`) : `<div class="empty">Traffic headlines are temporarily unavailable.</div>`}</div>
          </section>
          <section class="home-feed-section">${sectionHead("Top stories", "News", "View all →", n.status === "fulfilled" ? `${n.value.items.length} stories` : "")}
            <div class="home-rows">${n.status === "fulfilled" ? (n.value.items.length ? n.value.items.slice(0, 3).map(newsRow).join("") : `<div class="empty">No stories available right now.</div>`) : `<div class="empty">News is temporarily unavailable.</div>`}</div>
          </section>
          <section class="home-feed-section home-events-section">${sectionHead("Coming up in Bengaluru", "Events", "Explore events →", ev.status === "fulfilled" ? `${ev.value.items.length} events` : "")}
            <div class="home-event-list">${ev.status === "fulfilled" ? (ev.value.items.length ? sortedEvents(ev.value.items, "nearest").slice(0, 2).map(eventCard).join("") : `<div class="empty">No upcoming listings right now.</div>`) : `<div class="empty">Events are temporarily unavailable.</div>`}</div>
          </section>
        </div>
      </div>
      ${[w, t, n, ev].filter((r) => r.status === "rejected").map((r) => fail(r.reason)).join("")}`;
  },
  async News() {
    const d = await api("/api/news");
    setNote(`${d.items.length} stories from ${d.feedsOk} feeds · updated ${ago(d.fetchedAt)}${d.stale ? " (cached)" : ""}`);
    const [lead, ...rest] = d.items;
    return `<section class="news-layout">${lead ? `<a class="news-lead" href="${esc(lead.link)}" target="_blank" rel="noopener noreferrer"><span class="tag">Top story · ${esc(lead.source)} · ${ago(lead.time)}</span><b>${esc(lead.title)}</b><span class="lead-cta">Read story ↗</span></a>` : `<div class="panel empty">No stories available right now.</div>`}
      <section class="headline-panel"><div class="list-heading"><h2>More headlines</h2><span>${rest.length} stories</span></div><div class="headline-list" id="news-list">${rest.slice(0, 8).map(newsRow).join("")}</div>${rest.length > 8 ? `<button class="more-button" id="news-more" data-next="8">Show more headlines</button>` : ""}</section></section>`;
  },
  async Traffic() {
    const d = await api("/api/traffic");
    setNote(`Traffic headlines and route estimates · updated ${ago(d.fetchedAt)}${d.stale ? " (cached)" : ""}`);
    const spots = ["Silk Board Junction", "Hebbal Flyover", "Tin Factory", "Marathahalli Bridge", "KR Puram"];
    return `<div class="traffic-layout"><section class="panel route-panel"><div class="panel-heading"><div><span class="tag">Plan a journey</span><h2>Route estimate</h2></div><span class="estimate-label">No live congestion data</span></div><div class="row"><input id="a" aria-label="Starting point" placeholder="From · e.g. Indiranagar" autocomplete="off"><input id="b" aria-label="Destination" placeholder="To · e.g. Electronic City" autocomplete="off"><button class="go" id="route">Find routes</button></div><datalist id="pl"></datalist><div id="routes"></div>
      <div class="popular-routes"><span>Popular areas</span>${spots.map((s) => `<a href="#" data-spot="${esc(s)}">${s}</a>`).join("")}</div></section>
      <section class="headline-panel traffic-headlines"><div class="list-heading"><h2>Traffic headlines</h2><span>${d.items.length} updates</span></div><div class="headline-list" id="traffic-list">${d.items.slice(0, 5).map(newsRow).join("")}</div>${d.items.length > 5 ? `<button class="more-button" id="traffic-more" data-next="5">Show more updates</button>` : d.items.length === 0 ? `<div class="panel empty">No traffic headlines available right now.</div>` : ""}</section></div>`;
  },
  async Events() {
    const data = await api("/api/events");
    displayedEvents = data.items;
    setNote(`${data.items.length} upcoming event listings · distances use your saved weather location or central Bengaluru. Check the organizer page for current registration availability.`);
    return `<div class="events-toolbar"><span>${data.items.length} upcoming events</span><label for="event-sort">Sort by <select id="event-sort"><option value="nearest">Nearest to me</option><option value="soonest">Happening soonest</option></select></label></div>
      <div class="event-grid" id="event-grid">${sortedEvents(data.items, "nearest").map(eventCard).join("") || `<div class="panel empty">No upcoming events are listed right now.</div>`}</div>
      <p class="event-footnote">Events are curated from organizer pages. Registration availability can change; confirm details with the organizer before you go.</p>`;
  },
  async Radio() {
    const d = await api("/api/radio");
    setNote(`${d.stations.length} Bengaluru FM stations. ${d.stations.filter((x) => x.stream).length} can play here; the others open the station website.`);
    return `<div class="panel"><h3>Now playing</h3><div id="np">Pick a station</div><audio id="player" controls></audio></div>
      <div class="grid">${d.stations.map((s, i) => `<a class="card" href="${esc(s.stream || s.site || "#")}" data-i="${i}" ${s.stream ? "" : 'target="_blank" rel="noopener"'}><span class="tag">${s.stream ? "Play here" : "Opens site"}</span>${s.freq ? `<span class="freq">${esc(s.freq)}</span>` : ""}<b>${esc(s.name)}</b><small>${esc(s.tags)}</small></a>`).join("")}</div>`;
  },
  async Weather() {
    const [w, areas] = await Promise.all([api(wxPath()), api("/api/areas")]);
    areasList = areas;
    setNote(`Open-Meteo · updated ${ago(w.fetchedAt)}${w.stale ? " (cached)" : ""}. Pick an area, search a place or tap the map.`);
    return `<div class="panel"><h3>Choose a location</h3>
      <div class="row"><select id="area" aria-label="Area"></select><input id="wq" placeholder="Search a place" list="pl2" autocomplete="off"><button class="go" id="here">Use my location</button></div>
      <datalist id="pl2"></datalist>
      <div id="map" style="height:320px;margin-top:12px;border:1px solid var(--line)"></div>
      <small id="wxmsg" style="display:block;margin-top:8px;color:var(--mute)">Tap the map to drop a pin anywhere in Bengaluru.</small></div>
      <h2 id="wxhead" style="margin:14px 0 0;font-size:20px;border-bottom:1px solid var(--line)"></h2>
      <div class="grid" id="wxcards"></div>`;
  },
  async Account() {
    const me = await api("/api/me");
    setNote(`Signed in as ${me.user}.`);
    return `<div class="panel" style="max-width:520px"><h3>Profile & appearance</h3><p>Manage your profile photo and choose a color theme for the dashboard.</p><a class="tab" href="/account.html">Open profile settings →</a></div>
      <div class="panel" style="max-width:420px"><h3>Change password</h3>
      <div style="display:grid;gap:10px">
        <input id="cur" type="password" placeholder="Current password" autocomplete="current-password">
        <input id="np" type="password" placeholder="New password (8+ characters)" autocomplete="new-password">
        <input id="np2" type="password" placeholder="Repeat new password" autocomplete="new-password">
        <button class="go" id="pwgo">Update password</button>
        <div id="pwmsg" style="min-height:20px"></div></div></div>`;
  },
};

async function render() {
  routeMapHandle?.destroy(); routeMapHandle = null;
  document.querySelectorAll(".tab[data-k]").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === tab));
  try { $("view").innerHTML = await views[tab](); wire(); } catch (e) { setNote("Offline"); $("view").innerHTML = fail(e); }
}
function wire() {
  document.querySelectorAll("[data-home-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.homeTab; location.hash = tab; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  wireHeadlineMore("news-more", "news-list", 8);
  wireHeadlineMore("traffic-more", "traffic-list", 5);
  if ($("event-sort")) $("event-sort").onchange = () => { $("event-grid").innerHTML = sortedEvents(displayedEvents, $("event-sort").value).map(eventCard).join("") || `<div class="panel empty">No upcoming events are listed right now.</div>`; };
  wireRoute();
  if ($("area")) wireWeather();
  if ($("pwgo")) wirePassword();
  const p = $("player");
  if (p) document.querySelectorAll("[data-i]").forEach((el) => {
    el.onclick = async (e) => {
      const d = await api("/api/radio"), s = d.stations[el.dataset.i];
      if (!s.stream) return;           // no stream: let the link open the station site
      e.preventDefault();
      p.src = s.stream; p.play().catch(() => ($("np").textContent = `${s.name}: stream blocked, try its website`));
      $("np").textContent = s.name;
    };
  });
}

function wireHeadlineMore(buttonId, listId, pageSize) {
  const button = $(buttonId), list = $(listId);
  if (!button || !list) return;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const endpoint = buttonId === "news-more" ? "/api/news" : "/api/traffic";
      const data = await api(endpoint), next = Number(button.dataset.next);
      const items = data.items.slice(next, next + pageSize);
      list.insertAdjacentHTML("beforeend", items.map(newsRow).join(""));
      const count = next + items.length;
      button.dataset.next = String(count);
      button.textContent = count < data.items.length ? "Show more headlines" : "That’s all for now";
      if (count >= data.items.length) button.remove();
    } catch (e) { button.textContent = "Could not load more"; }
    finally { if (button.isConnected) button.disabled = false; }
  };
}

$("tabs").innerHTML = TABS.map((k) => `<button class="tab" role="tab" data-k="${k}">${k}</button>`).join("");
$("tabs").onclick = (e) => { const k = e.target.dataset.k; if (k) { tab = k; location.hash = k; render(); } };

function tick() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const h = d.getHours(), wk = d.getDay() > 0 && d.getDay() < 6, peak = wk && ((h >= 8 && h < 11) || (h >= 17 && h < 21));
  $("clock").textContent = d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " IST";
  const p = $("peak"); p.textContent = peak ? "Peak traffic hours" : "Off-peak window"; p.classList.toggle("peak", peak); p.classList.toggle("calm", !peak);
}
tick(); setInterval(tick, 30000);
api("/api/me").then((m) => {
  if (m.theme) { document.documentElement.setAttribute("data-theme", m.theme); try { localStorage.setItem("blr-theme", m.theme); } catch {} }
  if ($("avatar")) {
    $("avatar").innerHTML = m.avatarV ? `<img alt="" src="/api/avatar?v=${m.avatarV}">` : esc(m.user[0].toUpperCase());
    $("avatar").title = `${m.user} · account`;
  }
  const b = document.createElement("button");
  b.className = "tab"; b.style.marginTop = "6px"; b.textContent = `${m.user} · Log out`;
  b.onclick = async () => { await fetch("/api/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); location.href = "/login.html"; };
  document.querySelector(".clock").append(b);
}).catch(() => {});
render();
setInterval(() => {
  if (tab === "Weather") return api(wxPath()).then(paintWx).catch(() => {});   // refresh cards, keep the map as is
  if (tab !== "Radio" && tab !== "Account" && !routeMapHandle) render();   // keep a shown route map in place
}, 60000);

// ---- route suggestions ----
const routeHTML = (d) => `<div class="note">${esc(d.from)} to ${esc(d.to)}. ${d.peak ? "Peak hours: times include a rough allowance for traffic." : "Off-peak: times assume lighter traffic."} Roads come from OpenStreetMap and are checked against current advisories; live congestion is not included.</div>
  <div class="rm-wrap" id="route-map"><div class="note" style="margin:14px">Loading map…</div></div>
  <div class="grid">${d.routes.map((r, i) => `<div class="panel rt${i === 0 ? " is-on" : ""}" data-ri="${i}" style="margin:0">
    <span class="tag">${r.recommended ? "Suggested" : "Alternative"}${r.labels.map((l) => " · " + esc(l)).join("")}</span>
    <div class="stat">${r.etaMin} min</div>
    <small>${r.km} km · ${r.freeFlowMin} min without traffic</small>
    <small>Via ${esc(r.via.join(", ") || "local roads")}</small>
    ${r.warnings.map((w) => `<small class="err">Warning: ${w.link ? `<a href="${esc(w.link)}" target="_blank" rel="noopener" style="color:inherit">${esc(w.text)}</a>` : esc(w.text)}</small>`).join("")}
    <small><a href="${esc(r.mapsUrl)}" target="_blank" rel="noopener" style="color:var(--acc)">Open in Google Maps for navigation</a></small></div>`).join("")}</div>`;

const loadRouteMap = () => (routeMapReady ||= new Promise((res, rej) => {
  const fail = (m) => { routeMapReady = null; rej(new Error(m)); };
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "/vendor/route-map.css"; document.head.append(css);
  const js = document.createElement("script");
  js.src = "/vendor/route-map.js";
  js.onload = () => (window.RouteMapWidget ? res(window.RouteMapWidget) : fail("The route map did not start."));
  js.onerror = () => fail("The route map is not built yet (run npm run build:map).");
  document.head.append(js);
}));

async function showRouteMap(d) {
  const el = $("route-map"); if (!el) return;
  const cards = [...document.querySelectorAll("#routes .rt[data-ri]")];
  const mark = (i) => cards.forEach((c, k) => c.classList.toggle("is-on", k === i));
  try {
    const W = await loadRouteMap();
    if ($("route-map") !== el) return;                 // tab or search changed while loading
    el.textContent = "";
    routeMapHandle = W.mount(el, { routes: d.routes, onSelect: mark });
    cards.forEach((c, k) => (c.onclick = (e) => { if (e.target.closest("a")) return; mark(k); routeMapHandle?.select(k); }));
  } catch (e) {
    el.className = "";
    el.innerHTML = `<div class="note">${esc(e.message)} You can still open each route in Google Maps below.</div>`;
  }
}

function wireRoute() {
  const go = $("route"); if (!go) return;
  let timer;
  const suggest = (el) => {
    clearTimeout(timer);
    const q = el.value.trim(); if (q.length < 3) return;
    timer = setTimeout(async () => {
      try {
        const list = await api("/api/places?q=" + encodeURIComponent(q));
        $("pl").innerHTML = list.map((p) => { picked.set(p.name, `${p.lat},${p.lon}`); return `<option value="${esc(p.name)}">`; }).join("");
      } catch {}
    }, 350);
  };
  ["a", "b"].forEach((id) => { $(id).setAttribute("list", "pl"); $(id).oninput = (e) => suggest(e.target); });
  document.querySelectorAll("[data-spot]").forEach((l) => (l.onclick = (e) => {
    e.preventDefault();
    $("b").value = l.dataset.spot;                      // fill the destination; search if a start is set
    if ($("a").value.trim()) go.click(); else $("a").focus();
  }));
  go.onclick = async () => {
    const a = $("a").value.trim(), b = $("b").value.trim();
    if (!a || !b) { $("routes").innerHTML = `<div class="panel err">Enter both a start and a destination.</div>`; return; }
    $("routes").innerHTML = `<div class="note">Finding routes…</div>`;
    try {
      const qs = new URLSearchParams({ from: picked.get(a) || a, to: picked.get(b) || b });
      routeMapHandle?.destroy(); routeMapHandle = null;
      const d = await api("/api/route?" + qs);
      $("routes").innerHTML = routeHTML(d);
      showRouteMap(d);
    } catch (e) { $("routes").innerHTML = `<div class="panel err">${esc(e.message)}</div>`; }
  };
}

// ---- weather location picker ----
const loadLeaflet = () => (leafletReady ||= new Promise((res, rej) => {
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.append(css);
  const js = document.createElement("script");
  js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
  js.onload = () => res(window.L); js.onerror = () => { leafletReady = null; rej(new Error("The map library could not load. Check your connection.")); };
  document.head.append(js);
}));

function paintWx(w) {
  if (!$("wxcards")) return;
  const a = w.location.area;
  $("wxhead").textContent = `Weather ${a.km < 1 ? "in" : "near"} ${a.name}${a.km >= 1 ? ` · ${a.km} km away` : ""}`;
  $("wxcards").innerHTML = weatherCards(w);
  const sel = $("area"), i = areasList.findIndex((x) => x.name === a.name);
  sel.value = a.km < 1 && i >= 0 ? String(i) : "";
}

async function applyLoc(l) {
  const msg = $("wxmsg");
  try {
    const w = await api(wxPath(l));          // only accept the location if the server can serve it
    loc = l; try { localStorage.setItem("blr-loc", JSON.stringify(l)); } catch {}
    if (pin) pin.setLatLng([l.lat, l.lon]);
    if (map) map.panTo([l.lat, l.lon]);
    paintWx(w); msg.textContent = "Tap the map to drop a pin anywhere in Bengaluru.";
  } catch (e) { msg.textContent = e.message; }
}

async function wireWeather() {
  const sel = $("area");
  sel.innerHTML = `<option value="">Pinned location</option>` + areasList.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join("");
  sel.onchange = () => { const a = areasList[sel.value]; if (a) applyLoc({ lat: a.lat, lon: a.lon }); };
  $("here").onclick = () => {
    if (!navigator.geolocation) { $("wxmsg").textContent = "This browser has no location support."; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => applyLoc({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      () => ($("wxmsg").textContent = "Location permission was denied. Pick an area or tap the map."), { timeout: 8000 });
  };
  let timer;
  $("wq").oninput = (e) => {
    clearTimeout(timer);
    const v = e.target.value.trim();
    if (picked.has(v)) { const [lat, lon] = picked.get(v).split(",").map(Number); return applyLoc({ lat, lon }); }
    if (v.length < 3) return;
    timer = setTimeout(async () => {
      try {
        const list = await api("/api/places?q=" + encodeURIComponent(v));
        $("pl2").innerHTML = list.map((p) => { picked.set(p.name, `${p.lat},${p.lon}`); return `<option value="${esc(p.name)}">`; }).join("");
      } catch {}
    }, 350);
  };
  try {
    const w = await api(wxPath()); paintWx(w);
    const L = await loadLeaflet();
    if (!$("map")) return;                       // tab changed while loading
    if (map) map.remove();
    const { lat, lon } = w.location;
    map = L.map("map").setView([lat, lon], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
    areasList.forEach((a) => L.circleMarker([a.lat, a.lon], { radius: 5, color: "#a9bd93", weight: 1, fillOpacity: 0.6 })
      .bindTooltip(a.name).on("click", (ev) => { L.DomEvent.stopPropagation(ev); applyLoc({ lat: a.lat, lon: a.lon }); }).addTo(map));
    pin = L.circleMarker([lat, lon], { radius: 9, color: "#e0b48a", fillColor: "#e0b48a", fillOpacity: 0.5 }).addTo(map);
    map.on("click", (e) => applyLoc({ lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4) }));
  } catch (e) { if ($("map")) $("map").innerHTML = `<div class="panel err">${esc(e.message)}</div>`; }
}

// ---- change password ----
function wirePassword() {
  $("pwgo").onclick = async () => {
    const msg = $("pwmsg"), show = (t, ok) => { msg.className = ok ? "ok" : "err"; msg.textContent = t; };
    if ($("np").value !== $("np2").value) return show("The two new passwords do not match.", false);
    $("pwgo").disabled = true;
    try {
      const res = await fetch("/api/password", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ current: $("cur").value, password: $("np").value }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) return (location.href = "/login.html");
      if (res.ok) { show("Password changed. Other devices have been signed out.", true); ["cur", "np", "np2"].forEach((i) => ($(i).value = "")); }
      else show(d.message || "Could not change the password.", false);
    } catch { show("Could not reach the server.", false); }
    $("pwgo").disabled = false;
  };
}

// ---- Bengaluru assistant ----
function wireChat() {
  const launcher = $("chat-launcher"), panel = $("city-chat"), input = $("chat-input");
  const messages = $("chat-messages"), form = $("chat-form"), send = $("chat-send"), status = $("chat-status");
  if (!launcher || !panel) return;
  const history = [];
  let aiEnabled = false;

  const scrollChat = () => { messages.scrollTop = messages.scrollHeight; };
  const addMessage = (value, role, sources = [], extra = "") => {
    const bubble = document.createElement("div");
    bubble.className = `chat-message ${role}${extra ? ` ${extra}` : ""}`;
    bubble.textContent = value;
    if (role === "assistant" && sources.length) {
      const list = document.createElement("div"); list.className = "chat-sources";
      for (const source of sources.slice(0, 6)) {
        let url;
        try { url = new URL(source.url, location.origin); } catch { continue; }
        if (!/^https?:$/.test(url.protocol)) continue;
        const link = document.createElement("a"); link.className = "chat-source";
        link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.textContent = source.title || "Open source";
        if (source.detail || source.kind) {
          const detail = document.createElement("small"); detail.textContent = [source.kind, source.detail].filter(Boolean).join(" · ");
          link.append(detail);
        }
        list.append(link);
      }
      if (list.childElementCount) bubble.append(list);
    }
    messages.append(bubble); scrollChat(); return bubble;
  };

  const setOpen = (open) => {
    panel.hidden = !open; panel.setAttribute("aria-hidden", String(!open));
    launcher.setAttribute("aria-expanded", String(open));
    if (open) input.focus(); else launcher.focus();
  };
  launcher.onclick = () => setOpen(panel.hidden);
  $("chat-close").onclick = () => setOpen(false);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) setOpen(false); });

  addMessage("Hi! I can help with Bengaluru routes, recent news, upcoming events and weather. What are you looking for?", "assistant");
  api("/api/chat/status").then((result) => {
    aiEnabled = result.aiEnabled;
    status.textContent = aiEnabled ? "Gemini AI · dashboard sources" : "Local data helper · add Gemini key for AI";
    status.classList.toggle("local-mode", !aiEnabled);
  }).catch(() => { status.textContent = "Routes · news · events"; });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.onclick = () => { input.value = button.dataset.prompt; form.requestSubmit(); };
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || send.disabled) return;
    input.value = "";
    const previousHistory = history.slice(-8);
    addMessage(message, "user");
    history.push({ role: "user", text: message });
    send.disabled = true;
    const pending = addMessage("Checking Bengaluru sources…", "assistant", [], "pending");
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history: previousHistory }),
      });
      const result = await response.json().catch(() => ({}));
      pending.remove();
      if (response.status === 401) { location.href = "/login.html"; return; }
      if (result.fallback) {
        const prefix = result.message ? `${result.message}\n\n` : "";
        addMessage(prefix + result.fallback.reply, "assistant", result.fallback.sources || []);
        history.push({ role: "assistant", text: result.fallback.reply });
      } else if (!response.ok) {
        addMessage(result.message || "I couldn't reach the assistant. Please try again.", "assistant");
      } else {
        addMessage(result.reply || "I couldn't form a response from the available data.", "assistant", result.sources || []);
        history.push({ role: "assistant", text: result.reply || "" });
      }
      history.splice(0, Math.max(0, history.length - 8));
    } catch {
      pending.remove(); addMessage("I couldn't reach the server. Please try again in a moment.", "assistant");
    } finally { send.disabled = false; input.focus(); }
  };
}

wireChat();
