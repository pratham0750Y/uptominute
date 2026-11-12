# Namma Bengaluru Live

```
client/   Browser UI (index.html, style.css, app.js). Only talks to /api/*.
server/   Node 18+ server, zero dependencies.
  server.js    routes, RSS parsing, weather, radio, TTL cache, static hosting
  chat.js      signed-in city assistant, live dashboard context, optional Gemini replies
  sources.js   feeds and stations. Edit this to add or remove sources.
```

## Setup (first time only)
1. Install Node.js 18+ and MySQL 8 (the MySQL Installer for Windows, or XAMPP).
2. In this folder run: `npm install`
3. In MySQL (as root) create the database and a user for the app:
```sql
CREATE DATABASE namma CHARACTER SET utf8mb4;
CREATE USER 'namma'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON namma.* TO 'namma'@'localhost';
```
4. Copy `.env.example` to `.env` and put the same password in MYSQL_PASSWORD.
5. Create accounts: `npm run user -- add alice` (also: `passwd`, `remove`, `list`).

## Bengaluru assistant
The floating **Ask Bengaluru** assistant can find route estimates, summarize current news, list upcoming events and answer weather/traffic questions from this dashboard's sources. It uses the same route and feed services as the dashboard. Without a Gemini key it still works as a basic local data helper.

To enable AI-written replies, get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey), then add these entries to your private `.env` file and restart the server:
```env
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.8-flash
```
The key stays on the server and is never sent to the browser. The assistant uses Gemini's Interactions API with `store: false`. Keep `.env` private and do not commit or share your key. The assistant is limited to 12 requests per signed-in account per minute.

Route answers are estimates, not live congestion data. Event listings are curated; registration opens on the organizer's site.

## Run
    npm start        # http://localhost:3000, sign in with an account from step 5

## API
| Endpoint | Returns | Cache |
|---|---|---|
| GET /api/news | merged, de-duplicated headlines | 5 min |
| GET /api/traffic | traffic advisory headlines | 3 min |
| GET /api/events | curated upcoming Bengaluru events | maintained in `server/sources.js` |
| GET /api/weather | temp, humidity, wind, AQI (Open-Meteo) | 10 min |
| GET /api/radio | Karnataka stations with stream URLs (radio-browser.info) | 1 h |
| GET /api/places?q= | place suggestions inside Bengaluru (OpenStreetMap) | 24 h |
| GET /api/route?from=&to= | up to 3 routes, ranked, with closure and advisory warnings (OSRM) | none |
| POST /api/chat | Bengaluru assistant; route/news/events/weather context, optional Gemini response | per user rate limited |
| GET /api/health | liveness | none |

If an upstream fails, the server returns the last cached copy flagged `stale: true`.

## Public deployment (Railway example)
To let people outside your Wi-Fi use the site, deploy the Node server and MySQL database to a public host. Railway can run both in one project:
1. Push this app folder to a Git repository. Keep `.env` out of Git; `.gitignore` excludes it. Do not publish the parent `D:\FSD` folder.
2. In Railway, create a project from the app repository and add a MySQL service. Set the app service start command to `npm start`.
3. In the app service, connect its MySQL environment variables (`MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`) to the database service. The app accepts these names directly, as well as the `MYSQL_HOST`/`MYSQL_PORT` variants.
4. Set `COOKIE_SECURE=1` for the host's HTTPS URL. Keep the database on the host's private network; only the web service needs a public domain.
5. Generate the web service's public domain, deploy, then create an account on that site. Accounts in your local MySQL database do not transfer automatically.

See [Railway's MySQL guide](https://docs.railway.com/databases/mysql) and [deployment guide](https://docs.railway.com/quick-start) for current dashboard steps.

Known closures that affect route suggestions are listed in `server/sources.js` (`KNOWN_CLOSURES`). Update them as roads reopen.

## Accounts and security
- People can sign up on the login page and change their password on the Account tab.
- The profile page (`/account.html`) supports a profile photo and a saved color theme. The app adds the required user columns to an existing database automatically on startup.
- To control who can sign up, set `ALLOW_SIGNUP=0` in `.env` (accounts then come only from `npm run user`) or set `SIGNUP_CODE` to require an invite code.
- A forgotten password cannot be reset from the website (there is no email). Run `npm run user -- passwd <name>` on the server.
- Passwords are stored as salted scrypt hashes; sessions last 7 days and are stored hashed .
- After 5 wrong tries for one username (or 20 from one computer) logins are blocked for 10 minutes.
- Over plain http on a LAN, traffic is not encrypted. Do not reuse an important password.
- Keep MySQL itself local: do not expose port 3306 to the network. Other computers only need to reach the website.
