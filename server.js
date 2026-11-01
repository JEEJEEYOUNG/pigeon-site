// 사랑을 경희대를 타고 — 서버
// 외부 라이브러리 없이 Node.js만으로 돌아가요.
// 실행: node server.js  →  브라우저에서 http://localhost:3000
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_DAYS = 14;
const IS_PROD = process.env.NODE_ENV === "production";

// ---------- 데이터 저장 (data/db.json) ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDb() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return {
      users: raw.users || [],
      posts: raw.posts || [],
      messages: raw.messages || [],
      sessions: raw.sessions || {},
    };
  } catch (e) {
    return { users: [], posts: [], messages: [], sessions: {} };
  }
}
const db = loadDb();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 100);
}

const newId = () => crypto.randomBytes(8).toString("hex");
const findUser = (id) => db.users.find((u) => u.id === id);

// ---------- 비밀번호 (scrypt로 암호화해서 저장) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, "hex");
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

// ---------- 로그인 유지 (쿠키 세션) ----------
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[sha(token)] = { userId, expires: Date.now() + SESSION_DAYS * 86400000 };
  save();
  res.setHeader("Set-Cookie",
    `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` + (IS_PROD ? "; Secure" : ""));
}
function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s || s.expires < Date.now()) return null;
  return findUser(s.userId) || null;
}
function endSession(req, res) {
  const token = parseCookies(req).sid;
  if (token) { delete db.sessions[sha(token)]; save(); }
  res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}
// 만료된 세션 정리 (하루 한 번)
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) delete db.sessions[k];
  save();
}, 86400000).unref();

// ---------- 입력 검사 ----------
const NICK_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
const LOGIN_RE = /^[A-Za-z0-9_]{4,20}$/;
const YEAR_RE = /^\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// 짧은 시간에 너무 많이 요청하는 것 막기
const hits = new Map();
function tooMany(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}

// ---------- 응답 도우미 ----------
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 20000) req.destroy(); else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
const meView = (u) => ({ id: u.id, nickname: u.nickname, major: u.major, year: u.year });

// ---------- API ----------
async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  const ip = req.socket.remoteAddress || "x";
  const user = currentUser(req);
  const body = method === "POST" ? await readBody(req) : {};
  const needLogin = () => send(res, 401, { error: "로그인이 필요해요." });

  // 가입
  if (method === "POST" && p === "/api/register") {
    if (tooMany("reg:" + ip, 10, 3600000)) return send(res, 429, { error: "잠시 후 다시 시도해 주세요." });
    const loginId = str(body.loginId, 20);
    const password = typeof body.password === "string" ? body.password : "";
    const nickname = str(body.nickname, 12);
    const major = str(body.major, 30);
    const year = str(body.year, 2);
    if (!LOGIN_RE.test(loginId)) return send(res, 400, { error: "아이디는 영문·숫자·_ 4~20자로 정해 주세요." });
    if (password.length < 8) return send(res, 400, { error: "비밀번호는 8자 이상이어야 해요." });
    if (!NICK_RE.test(nickname)) return send(res, 400, { error: "닉네임은 한글·영문·숫자 2~12자로 정해 주세요." });
    if (!major) return send(res, 400, { error: "학과를 입력해 주세요." });
    if (!YEAR_RE.test(year)) return send(res, 400, { error: "학번을 선택해 주세요." });
    if (db.users.some((u) => u.loginId.toLowerCase() === loginId.toLowerCase()))
      return send(res, 409, { error: "이미 있는 아이디예요." });
    if (db.users.some((u) => u.nickname.toLowerCase() === nickname.toLowerCase()))
      return send(res, 409, { error: "이미 쓰고 있는 닉네임이에요." });
    const u = {
      id: newId(), loginId, passwordHash: hashPassword(password), nickname,
      major, year, // 비공개 — 본인에게만 보여줌
      createdAt: Date.now(),
    };
    db.users.push(u); save();
    startSession(res, u.id);
    return send(res, 200, meView(u));
  }

  // 로그인
  if (method === "POST" && p === "/api/login") {
    if (tooMany("login:" + ip, 10, 60000)) return send(res, 429, { error: "잠시 후 다시 시도해 주세요." });
    const loginId = str(body.loginId, 20);
    const password = typeof body.password === "string" ? body.password : "";
    const u = db.users.find((x) => x.loginId.toLowerCase() === loginId.toLowerCase());
    if (!u || !checkPassword(password, u.passwordHash)) return send(res, 401, { error: "아이디 또는 비밀번호가 맞지 않아요." });
    startSession(res, u.id);
    return send(res, 200, meView(u));
  }

  if (method === "POST" && p === "/api/logout") { endSession(req, res); return send(res, 200, { ok: true }); }

  if (method === "GET" && p === "/api/me") return user ? send(res, 200, meView(user)) : needLogin();

  // 피드 보기 (로그인 안 해도 볼 수 있음, 닉네임만 공개)
  if (method === "GET" && p === "/api/posts") {
    const myId = user ? user.id : null;
    const list = db.posts.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((x) => {
      const a = findUser(x.authorId);
      return {
        id: x.id, authorId: x.authorId, nickname: a ? a.nickname : "탈퇴한 비둘기",
        date: x.date, place: x.place, text: x.text, createdAt: x.createdAt, mine: x.authorId === myId,
      };
    });
    return send(res, 200, list);
  }

  // 글 쓰기
  if (method === "POST" && p === "/api/posts") {
    if (!user) return needLogin();
    if (tooMany("post:" + user.id, 5, 60000)) return send(res, 429, { error: "조금 천천히 날려 주세요." });
    const date = str(body.date, 10), place = str(body.place, 40), text = str(body.text, 300);
    if (!DATE_RE.test(date) || !place || !text) return send(res, 400, { error: "날짜, 장소, 내용을 모두 채워 주세요." });
    const post = { id: newId(), authorId: user.id, date, place, text, createdAt: Date.now() };
    db.posts.push(post); save();
    return send(res, 200, { ok: true, id: post.id });
  }

  // 글 삭제 — 글쓴이 본인만
  const delMatch = p.match(/^\/api\/posts\/([a-f0-9]{16})$/);
  if (method === "DELETE" && delMatch) {
    if (!user) return needLogin();
    const i = db.posts.findIndex((x) => x.id === delMatch[1]);
    if (i < 0) return send(res, 404, { error: "글을 찾을 수 없어요." });
    if (db.posts[i].authorId !== user.id) return send(res, 403, { error: "본인이 쓴 글만 삭제할 수 있어요." });
    db.posts.splice(i, 1); save();
    return send(res, 200, { ok: true });
  }

  // 쪽지함 — 내가 보냈거나 받은 쪽지만
  if (method === "GET" && p === "/api/conversations") {
    if (!user) return needLogin();
    const byOther = new Map();
    for (const m of db.messages) {
      if (m.from !== user.id && m.to !== user.id) continue;
      const other = m.from === user.id ? m.to : m.from;
      if (!byOther.has(other)) byOther.set(other, []);
      byOther.get(other).push({ mine: m.from === user.id, text: m.text, createdAt: m.createdAt, about: m.about || null });
    }
    const list = [...byOther.entries()].map(([otherId, msgs]) => {
      msgs.sort((a, b) => a.createdAt - b.createdAt);
      const o = findUser(otherId);
      return { otherId, otherNickname: o ? o.nickname : "탈퇴한 비둘기", messages: msgs, last: msgs[msgs.length - 1].createdAt };
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
    if (to === user.id) return send(res, 400, { error: "나에게는 쪽지를 보낼 수 없어요." });
    if (!findUser(to)) return send(res, 404, { error: "받는 사람을 찾을 수 없어요." });
    let about = null;
    if (typeof body.postId === "string") {
      const post = db.posts.find((x) => x.id === body.postId);
      if (post) about = { date: post.date, place: post.place };
    }
    db.messages.push({ id: newId(), from: user.id, to, text, about, createdAt: Date.now() });
    save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "없는 주소예요." });
}

// ---------- 화면 파일 ----------
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json",
};
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
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
    if (!res.headersSent) send(res, 500, { error: "서버에 문제가 생겼어요." });
  }
}).listen(PORT, () => {
  console.log("");
  console.log("  🕊  사랑을 경희대를 타고 서버가 켜졌어요");
  console.log("  →  http://localhost:" + PORT);
  console.log("     (끄려면 Ctrl + C)");
  console.log("");
});
