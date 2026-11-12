// MySQL storage for accounts and sessions. All SQL lives in this file.
const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
     id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     username VARCHAR(50) NOT NULL UNIQUE,
     password_hash VARCHAR(255) NOT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     theme VARCHAR(20) NOT NULL DEFAULT 'olive',
     avatar MEDIUMTEXT NULL,
     avatar_v BIGINT NOT NULL DEFAULT 0
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash CHAR(64) PRIMARY KEY,
     user_id INT UNSIGNED NOT NULL,
     expires_at BIGINT NOT NULL,
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   ) CHARACTER SET utf8mb4`,
];

const NEW_USER_COLUMNS = {
  theme: "ALTER TABLE users ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'olive'",
  avatar: "ALTER TABLE users ADD COLUMN avatar MEDIUMTEXT NULL",
  avatar_v: "ALTER TABLE users ADD COLUMN avatar_v BIGINT NOT NULL DEFAULT 0",
};

function explain(e, cfg) {
  if (e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "ENOTFOUND")
    return `Cannot reach MySQL at ${cfg.host}:${cfg.port}. Is the MySQL server running? (Windows: open services.msc and start "MySQL80".)`;
  if (e.code === "ER_ACCESS_DENIED_ERROR")
    return `MySQL refused the login for user "${cfg.user}". Check MYSQL_USER and MYSQL_PASSWORD in your .env file.`;
  if (e.code === "ER_BAD_DB_ERROR")
    return `The database "${cfg.database}" does not exist. Create it first (see README, step 3).`;
  return `MySQL error: ${e.code || ""} ${e.message}`.trim();
}

export async function openStore() {
  let mysql;
  try { const mod = await import("mysql2/promise"); mysql = mod.default ?? mod; }
  catch { throw new Error('The "mysql2" package is missing. Run: npm install'); }

  const cfg = {
    host: process.env.MYSQL_HOST || process.env.MYSQLHOST || "127.0.0.1",
    port: +(process.env.MYSQL_PORT || process.env.MYSQLPORT) || 3306,
    user: process.env.MYSQL_USER || process.env.MYSQLUSER || "namma",
    password: process.env.MYSQL_PASSWORD ?? process.env.MYSQLPASSWORD ?? "",
    database: process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || "namma",
    waitForConnections: true,
    connectionLimit: 5,
  };
  if (process.env.MYSQL_SSL === "1") {
  cfg.ssl = {
    minVersion: "TLSv1.2"
  };
}

  const pool = mysql.createPool(cfg);
  try {
    await pool.query("SELECT 1");
    for (const sql of DDL) await pool.query(sql);          // tables are created automatically
    const have = new Set((await pool.query(
      "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"))[0].map((r) => r.name));
    for (const [col, sql] of Object.entries(NEW_USER_COLUMNS)) if (!have.has(col)) await pool.query(sql);
  } catch (e) { await pool.end().catch(() => {}); throw new Error(explain(e, cfg)); }

  const rows = async (sql, p = []) => (await pool.execute(sql, p))[0];
  return {
    async createUser(username, hash) {
      try { await rows("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash]); return true; }
      catch (e) { if (e.code === "ER_DUP_ENTRY") return false; throw e; }
    },
    async getUserByName(username) {
      return (await rows("SELECT id, username, password_hash FROM users WHERE username = ?", [username]))[0] || null;
    },
    async setPassword(username, hash) {
      return (await rows("UPDATE users SET password_hash = ? WHERE username = ?", [hash, username])).affectedRows > 0;
    },
    async removeUser(username) {
      return (await rows("DELETE FROM users WHERE username = ?", [username])).affectedRows > 0;   // sessions cascade
    },
    listUsers: () => rows("SELECT username, created_at FROM users ORDER BY id"),
    createSession: (tokenHash, userId, expiresMs) =>
      rows("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [tokenHash, userId, expiresMs]),
    async getSession(tokenHash, nowMs) {
      return (await rows(
        "SELECT u.id, u.username, u.theme, u.avatar_v FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        [tokenHash, nowMs]))[0] || null;
    },
    setTheme: (userId, theme) => rows("UPDATE users SET theme = ? WHERE id = ?", [theme, userId]),
    async setAvatar(userId, dataUrl) {
      const v = dataUrl ? Date.now() : 0;
      await rows("UPDATE users SET avatar = ?, avatar_v = ? WHERE id = ?", [dataUrl, v, userId]);
      return v;
    },
    async getAvatar(userId) {
      return (await rows("SELECT avatar FROM users WHERE id = ?", [userId]))[0]?.avatar || null;
    },
    deleteSession: (tokenHash) => rows("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]),
    deleteUserSessions: (userId) => rows("DELETE FROM sessions WHERE user_id = ?", [userId]),
    purgeExpired: (nowMs) => rows("DELETE FROM sessions WHERE expires_at <= ?", [nowMs]),
    close: () => pool.end(),
  };
}
