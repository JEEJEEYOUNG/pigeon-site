// 사랑을 경희대를 타고 — 서버
// 외부 라이브러리 없이 Node.js(18 이상)만으로 돌아가요.
//
// 데이터 저장 위치
//  - 환경변수 SUPABASE_URL, SUPABASE_SECRET_KEY 가 있으면 → Supabase 데이터베이스 (인터넷에 올릴 때)
//  - 없으면 → 내 컴퓨터의 data/db.json 파일 (연습용)
//
// 실행: node server.js  →  브라우저에서 http://localhost:3000
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_DAYS = 14;
const IS_PROD = process.env.NODE_ENV === "production";

const newId = () => crypto.randomBytes(8).toString("hex");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

class Conflict extends Error {}

// =====================================================================
// 저장소 1: 내 컴퓨터 파일 (data/db.json)
// =====================================================================
function fileStore() {
  const DATA_DIR = path.join(__dirname, "data");
  const DB_FILE = path.join(DATA_DIR, "db.json");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let db;
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    db = { users: raw.users || [], posts: raw.posts || [], messages: raw.messages || [], sessions: raw.sessions || {} };
  } catch (e) {
    db = { users: [], posts: [], messages: [], sessions: {} };
  }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db, null, 2));
      fs.renameSync(DB_FILE + ".tmp", DB_FILE);
    }, 100);
  };
  return {
    name: "내 컴퓨터 파일 (data/db.json)",
    async userById(id) { return db.users.find((u) => u.id === id) || null; },
    async usersByIds(ids) { return db.users.filter((u) => ids.includes(u.id)); },
    async userByLogin(lower) { return db.users.find((u) => u.loginLower === lower) || null; },
    async nickTaken(lower) { return db.users.some((u) => u.nickLower === lower); },
    async createUser(u) {
      if (db.users.some((x) => x.loginLower === u.loginLower || x.nickLower === u.nickLower)) throw new Conflict();
      db.users.push(u); save();
    },
    async listPosts(limit) { return db.posts.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, limit); },
    async postById(id) { return db.posts.find((p) => p.id === id) || null; },
    async createPost(p) { db.posts.push(p); save(); },
    async deletePost(id) { db.posts = db.posts.filter((p) => p.id !== id); save(); },
    async messagesOf(uid) { return db.messages.filter((m) => m.from === uid || m.to === uid); },
    async createMessage(m) { db.messages.push(m); save(); },
    async createSession(hash, userId, expires) { db.sessions[hash] = { userId, expires }; save(); },
    async session(hash) { return db.sessions[hash] || null; },
    async deleteSession(hash) { delete db.sessions[hash]; save(); },
    async cleanSessions(now) { for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) delete db.sessions[k]; save(); },
  };
}

// =====================================================================
// 저장소 2: Supabase (인터넷에 올릴 때)
// =====================================================================
function supabaseStore(baseUrl, key) {
  const root = baseUrl.replace(/\/+$/, "") + "/rest/v1/";
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = "Bearer " + key; // 예전 방식(service_role) 키도 지원
  const q = encodeURIComponent;

  async function call(method, pathAndQuery, body, prefer) {
    const h = Object.assign({}, headers);
    if (prefer) h.Prefer = prefer;
    const res = await fetch(root + pathAndQuery, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (res.status === 409 || (data && data.code === "23505")) throw new Conflict();
    if (!res.ok) throw new Error("Supabase " + res.status + ": " + text.slice(0, 300));
    return data;
  }

  const toUser = (r) => r && {
    id: r.id, loginId: r.login_id, loginLower: r.login_lower, passwordHash: r.password_hash,
    nickname: r.nickname, nickLower: r.nick_lower, createdAt: Number(r.created_at),
  };
  const toPost = (r) => ({ id: r.id, authorId: r.author_id, date: r.date, place: r.place, text: r.text, createdAt: Number(r.created_at) });
  const toMsg = (r) => ({ id: r.id, from: r.from_id, to: r.to_id, text: r.text, about: r.about || null, createdAt: Number(r.created_at) });

  return {
    name: "Supabase 데이터베이스",
    async userById(id) { const r = await call("GET", "users?select=*&id=eq." + q(id)); return toUser(r[0]) || null; },
    async usersByIds(ids) {
      if (!ids.length) return [];
      const r = await call("GET", "users?select=id,nickname&id=in.(" + ids.map(q).join(",") + ")");
      return r.map((x) => ({ id: x.id, nickname: x.nickname }));
    },
    async userByLogin(lower) { const r = await call("GET", "users?select=*&login_lower=eq." + q(lower)); return toUser(r[0]) || null; },
    async nickTaken(lower) { const r = await call("GET", "users?select=id&nick_lower=eq." + q(lower)); return r.length > 0; },
    async createUser(u) {
      await call("POST", "users", {
        id: u.id, login_id: u.loginId, login_lower: u.loginLower, password_hash: u.passwordHash,
        nickname: u.nickname, nick_lower: u.nickLower, created_at: u.createdAt,
      }, "return=minimal");
    },
    async listPosts(limit) { return (await call("GET", "posts?select=*&order=created_at.desc&limit=" + limit)).map(toPost); },
    async postById(id) { const r = await call("GET", "posts?select=*&id=eq." + q(id)); return r[0] ? toPost(r[0]) : null; },
    async createPost(p) {
      await call("POST", "posts", { id: p.id, author_id: p.authorId, date: p.date, place: p.place, text: p.text, created_at: p.createdAt }, "return=minimal");
    },
    async deletePost(id) { await call("DELETE", "posts?id=eq." + q(id)); },
    async messagesOf(uid) {
      return (await call("GET", "messages?select=*&or=(from_id.eq." + q(uid) + ",to_id.eq." + q(uid) + ")&order=created_at.asc")).map(toMsg);
    },
    async createMessage(m) {
      await call("POST", "messages", { id: m.id, from_id: m.from, to_id: m.to, text: m.text, about: m.about, created_at: m.createdAt }, "return=minimal");
    },
    async createSession(hash, userId, expires) {
      await call("POST", "sessions", { token_hash: hash, user_id: userId, expires }, "return=minimal");
    },
    async session(hash) {
      const r = await call("GET", "sessions?select=*&token_hash=eq." + q(hash));
      return r[0] ? { userId: r[0].user_id, expires: Number(r[0].expires) } : null;
    },
    async deleteSession(hash) { await call("DELETE", "sessions?token_hash=eq." + q(hash)); },
    async cleanSessions(now) { await call("DELETE", "sessions?expires=lt." + now); },
  };
}

const store = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? supabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  : fileStore();

// =====================================================================
// 비밀번호 (scrypt로 암호화해서 저장)
// =====================================================================
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, "hex");
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

// =====================================================================
// 로그인 유지 (쿠키)
// =====================================================================
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} }
  });
  return out;
}
async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await store.createSession(sha(token), userId, Date.now() + SESSION_DAYS * 86400000);
  res.setHeader("Set-Cookie",
    `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` + (IS_PROD ? "; Secure" : ""));
}
async function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = await store.session(sha(token));
  if (!s || s.expires < Date.now()) return null;
  return store.userById(s.userId);
}
async function endSession(req, res) {
  const token = parseCookies(req).sid;
  if (token && /^[a-f0-9]{64}$/.test(token)) await store.deleteSession(sha(token));
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}
setInterval(() => { store.cleanSessions(Date.now()).catch(() => {}); }, 86400000).unref();

// =====================================================================
// 입력 검사, 요청 제한
// =====================================================================
const NICK_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
const LOGIN_RE = /^[A-Za-z0-9_]{4,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-f0-9]{16}$/;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const hits = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < 3600000)) hits.delete(k); }, 600000).unref();
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "x";
}

// =====================================================================
// 응답 도우미
// =====================================================================
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 20000) req.destroy(); else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
const meView = (u) => ({ id: u.id, nickname: u.nickname });
async function nicknameMap(ids) {
  const uniq = [...new Set(ids)];
  const map = {};
  for (const u of await store.usersByIds(uniq)) map[u.id] = u.nickname;
  return map;
}

// =====================================================================
// API
// =====================================================================
async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  const ip = clientIp(req);
  const body = method === "POST" ? await readBody(req) : {};
  const user = await currentUser(req);
  const needLogin = () => send(res, 401, { error: "로그인이 필요해요." });

  // 가입
  if (method === "POST" && p === "/api/register") {
    if (tooMany("reg:" + ip, 10, 3600000)) return send(res, 429, { error: "잠시 후 다시 시도해 주세요." });
    const loginId = str(body.loginId, 20);
    const password = typeof body.password === "string" ? body.password : "";
    const nickname = str(body.nickname, 12);
    if (!LOGIN_RE.test(loginId)) return send(res, 400, { error: "아이디는 영문·숫자·_ 4~20자로 정해 주세요." });
    if (password.length < 8 || password.length > 100) return send(res, 400, { error: "비밀번호는 8자 이상이어야 해요." });
    if (!NICK_RE.test(nickname)) return send(res, 400, { error: "닉네임은 한글·영문·숫자 2~12자로 정해 주세요." });
    const loginLower = loginId.toLowerCase(), nickLower = nickname.toLowerCase();
    if (await store.userByLogin(loginLower)) return send(res, 409, { error: "이미 있는 아이디예요." });
    if (await store.nickTaken(nickLower)) return send(res, 409, { error: "이미 쓰고 있는 닉네임이에요." });
    const u = {
      id: newId(), loginId, loginLower, passwordHash: hashPassword(password), nickname, nickLower,
      createdAt: Date.now(),
    };
    try { await store.createUser(u); }
    catch (e) { if (e instanceof Conflict) return send(res, 409, { error: "이미 있는 아이디나 닉네임이에요." }); throw e; }
    await startSession(res, u.id);
    return send(res, 200, meView(u));
  }

  // 로그인
  if (method === "POST" && p === "/api/login") {
    if (tooMany("login:" + ip, 10, 60000)) return send(res, 429, { error: "잠시 후 다시 시도해 주세요." });
    const loginId = str(body.loginId, 20);
    const password = typeof body.password === "string" ? body.password.slice(0, 100) : "";
    const u = LOGIN_RE.test(loginId) ? await store.userByLogin(loginId.toLowerCase()) : null;
    if (!u || !checkPassword(password, u.passwordHash)) return send(res, 401, { error: "아이디 또는 비밀번호가 맞지 않아요." });
    await startSession(res, u.id);
    return send(res, 200, meView(u));
  }

  if (method === "POST" && p === "/api/logout") { await endSession(req, res); return send(res, 200, { ok: true }); }

  if (method === "GET" && p === "/api/me") return user ? send(res, 200, meView(user)) : needLogin();

  // 피드 (로그인 안 해도 볼 수 있음, 닉네임만 공개)
  if (method === "GET" && p === "/api/posts") {
    const myId = user ? user.id : null;
    const list = await store.listPosts(300);
    const nicks = await nicknameMap(list.map((x) => x.authorId));
    return send(res, 200, list.map((x) => ({
      id: x.id, authorId: x.authorId, nickname: nicks[x.authorId] || "탈퇴한 비둘기",
      date: x.date, place: x.place, text: x.text, createdAt: x.createdAt, mine: x.authorId === myId,
    })));
  }

  // 글 쓰기
  if (method === "POST" && p === "/api/posts") {
    if (!user) return needLogin();
    if (tooMany("post:" + user.id, 5, 60000)) return send(res, 429, { error: "조금 천천히 날려 주세요." });
    const date = str(body.date, 10), place = str(body.place, 40), text = str(body.text, 300);
    if (!DATE_RE.test(date) || !place || !text) return send(res, 400, { error: "날짜, 장소, 내용을 모두 채워 주세요." });
    const post = { id: newId(), authorId: user.id, date, place, text, createdAt: Date.now() };
    await store.createPost(post);
    return send(res, 200, { ok: true, id: post.id });
  }

  // 글 삭제 — 글쓴이 본인만
  const delMatch = p.match(/^\/api\/posts\/([a-f0-9]{16})$/);
  if (method === "DELETE" && delMatch) {
    if (!user) return needLogin();
    const post = await store.postById(delMatch[1]);
    if (!post) return send(res, 404, { error: "글을 찾을 수 없어요." });
    if (post.authorId !== user.id) return send(res, 403, { error: "본인이 쓴 글만 삭제할 수 있어요." });
    await store.deletePost(post.id);
    return send(res, 200, { ok: true });
  }

  // 쪽지함 — 내가 보냈거나 받은 쪽지만
  if (method === "GET" && p === "/api/conversations") {
    if (!user) return needLogin();
    const msgs = await store.messagesOf(user.id);
    const byOther = new Map();
    for (const m of msgs) {
      const other = m.from === user.id ? m.to : m.from;
      if (!byOther.has(other)) byOther.set(other, []);
      byOther.get(other).push({ mine: m.from === user.id, text: m.text, createdAt: m.createdAt, about: m.about || null });
    }
    const nicks = await nicknameMap([...byOther.keys()]);
    const list = [...byOther.entries()].map(([otherId, ms]) => {
      ms.sort((a, b) => a.createdAt - b.createdAt);
      return { otherId, otherNickname: nicks[otherId] || "탈퇴한 비둘기", messages: ms, last: ms[ms.length - 1].createdAt };
    });
    list.sort((a, b) => b.last - a.last);
    return send(res, 200, list);
  }

  // 쪽지 보내기
  if (method === "POST" && p === "/api/messages") {
    if (!user) return needLogin();
    if (tooMany("msg:" + user.id, 20, 60000)) return send(res, 429, { error: "조금 천천히 보내 주세요." });
    const to = str(body.to, 40), text = str(body.text, 300);
    if (!text) return send(res, 400, { error: "내용을 적어 주세요." });
    if (!ID_RE.test(to)) return send(res, 404, { error: "받는 사람을 찾을 수 없어요." });
    if (to === user.id) return send(res, 400, { error: "나에게는 쪽지를 보낼 수 없어요." });
    if (!(await store.userById(to))) return send(res, 404, { error: "받는 사람을 찾을 수 없어요." });
    let about = null;
    if (typeof body.postId === "string" && ID_RE.test(body.postId)) {
      const post = await store.postById(body.postId);
      if (post) about = { date: post.date, place: post.place };
    }
    await store.createMessage({ id: newId(), from: user.id, to, text, about, createdAt: Date.now() });
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "없는 주소예요." });
}

// =====================================================================
// 화면 파일
// =====================================================================
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json",
};
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("페이지를 찾을 수 없어요."); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요." });
  }
}).listen(PORT, () => {
  console.log("");
  console.log("  🕊  사랑을 경희대를 타고 서버가 켜졌어요");
  console.log("  →  http://localhost:" + PORT);
  console.log("     저장 위치: " + store.name);
  console.log("     (끄려면 Ctrl + C)");
  console.log("");
});
