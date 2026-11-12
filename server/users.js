// Manage accounts from the terminal:
//   npm run user -- add alice        npm run user -- passwd alice
//   npm run user -- remove alice     npm run user -- list
import readline from "node:readline";
import { loadEnv } from "./env.js";
import { openStore } from "./db.js";
import { hashPassword, checkPassword, normUser, USERNAME_RE } from "./auth.js";

loadEnv();
const [cmd, rawName] = process.argv.slice(2);
const usage = () => { console.log("Usage: npm run user -- <add|passwd|remove|list> [username]"); process.exit(1); };
if (!["add", "passwd", "remove", "list"].includes(cmd)) usage();

const tty = process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!tty });
const lines = rl[Symbol.asyncIterator]();
let muted = false;
rl._writeToOutput = (s) => { if (!muted) process.stdout.write(s); };
async function ask(q, hidden = false) {
  process.stdout.write(q);
  muted = hidden && tty;
  const { value } = await lines.next();
  if (muted) process.stdout.write("\n");
  muted = false;
  return value ?? "";
}
async function askPassword() {
  const a = await ask("Password (min 8 characters): ", true);
  const problem = checkPassword(a);
  if (problem) throw new Error(problem);
  if (a !== (await ask("Repeat password: ", true))) throw new Error("The two passwords do not match.");
  return a;
}

let store;
try {
  store = await openStore();
  if (cmd === "list") {
    const users = await store.listUsers();
    console.log(users.length ? users.map((u) => `${u.username}  (created ${new Date(u.created_at).toISOString().slice(0, 10)})`).join("\n") : "No accounts yet. Add one with: npm run user -- add <username>");
  } else {
    const name = normUser(rawName);
    if (!USERNAME_RE.test(name)) throw new Error("Username must be 3-30 characters: letters, numbers, dot, dash or underscore.");
    if (cmd === "add") {
      const hash = await hashPassword(await askPassword());
      console.log((await store.createUser(name, hash)) ? `Account "${name}" created.` : `"${name}" already exists. Use "passwd" to change its password.`);
    } else if (cmd === "passwd") {
      const user = await store.getUserByName(name);
      if (!user) throw new Error(`No account named "${name}".`);
      await store.setPassword(name, await hashPassword(await askPassword()));
      await store.deleteUserSessions(user.id);   // signs that user out everywhere
      console.log(`Password changed for "${name}". They have been signed out.`);
    } else {
      console.log((await store.removeUser(name)) ? `Account "${name}" removed.` : `No account named "${name}".`);
    }
  }
} catch (e) { console.error("Error: " + e.message); process.exitCode = 1; }
finally { rl.close(); if (store) await store.close(); }
