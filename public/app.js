// 사랑을 경희대를 타고 — 화면 동작
(function () {
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const today = new Date();

  let me = null;          // 로그인한 나 {id, nickname}
  let posts = [];
  let convs = [];
  let tab = "feed";
  let armed = null;       // 삭제 확인 대기 중인 글
  let openReply = null;   // 쪽지 창이 열린 글
  const drafts = {};
  const seen = new Set();
  let firstLoad = true;
  let lastSeenInbox = Number(safeGet("pigeon-inbox-seen")) || 0;

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || "문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    return data;
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function flash(node, t) { node.textContent = t; setTimeout(() => { if (node.textContent === t) node.textContent = ""; }, 3500); }
  function fmtDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? m[1] + "년 " + Number(m[2]) + "월 " + Number(m[3]) + "일" : "";
  }
  function ago(ms) {
    if (!ms) return "";
    const d = (Date.now() - ms) / 1000;
    if (d < 60) return "방금";
    if (d < 3600) return Math.floor(d / 60) + "분 전";
    if (d < 86400) return Math.floor(d / 3600) + "시간 전";
    return Math.floor(d / 86400) + "일 전";
  }

  // ---------- 초기 값 ----------
  $("f-date").value = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
  $("f-text").addEventListener("input", (e) => { $("count").textContent = e.target.value.length + "/300"; });

  // ---------- 로그인 / 가입 ----------
  function setAuthTab(which) {
    $("at-register").setAttribute("aria-selected", which === "register");
    $("at-login").setAttribute("aria-selected", which === "login");
    $("register").hidden = which !== "register";
    $("login").hidden = which !== "login";
    $("auth-status").textContent = "";
  }
  $("at-register").addEventListener("click", () => setAuthTab("register"));
  $("at-login").addEventListener("click", () => setAuthTab("login"));

  $("register").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const st = $("auth-status");
    if (!$("r-agree").checked) { st.textContent = "개인정보 처리방침에 동의해 주세요."; return; }
    try {
      me = await api("POST", "/api/register", {
        loginId: $("r-id").value, password: $("r-pw").value,
        nickname: $("r-nick").value,
      });
      $("register").reset();
      afterLogin();
    } catch (e) { st.textContent = e.message; }
  });

  $("login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      me = await api("POST", "/api/login", { loginId: $("l-id").value, password: $("l-pw").value });
      $("login").reset();
      afterLogin();
    } catch (e) { $("auth-status").textContent = e.message; }
  });

  async function logout() {
    try { await api("POST", "/api/logout"); } catch (e) {}
    me = null; convs = [];
    renderGate(); loadPosts(); renderInbox();
  }

  function afterLogin() { renderGate(); loadPosts(); loadConvs(); }

  function renderGate() {
    $("auth").hidden = !!me;
    $("compose").hidden = !me;
    const ml = $("me-line");
    ml.hidden = !me;
    ml.textContent = "";
    if (me) {
      const l = el("span");
      l.append("나는 "); l.appendChild(el("b", null, me.nickname));
      const out = el("button", "link", "로그아웃"); out.type = "button";
      out.addEventListener("click", logout);
      ml.append(l, out);
    }
  }

  function needLogin() {
    $("auth").hidden = false;
    setAuthTab("login");
    $("auth").scrollIntoView({ behavior: "smooth", block: "center" });
    $("auth-status").textContent = "로그인하면 쪽지를 보낼 수 있어요.";
  }

  // ---------- 탭 ----------
  function setTab(t) {
    tab = t;
    $("tab-feed").setAttribute("aria-selected", t === "feed");
    $("tab-inbox").setAttribute("aria-selected", t === "inbox");
    $("view-feed").hidden = t !== "feed";
    $("view-inbox").hidden = t !== "inbox";
    if (t === "inbox") { lastSeenInbox = Date.now(); safeSet("pigeon-inbox-seen", String(lastSeenInbox)); }
    renderInbox();
  }
  $("tab-feed").addEventListener("click", () => setTab("feed"));
  $("tab-inbox").addEventListener("click", () => setTab("inbox"));

  // ---------- 피드 ----------
  async function loadPosts() {
    try {
      const next = await api("GET", "/api/posts");
      if (!firstLoad && JSON.stringify(next) === JSON.stringify(posts)) return;
      posts = next; renderFeed();
    }
    catch (e) { /* 다음 새로고침 때 다시 시도 */ }
  }

  function renderFeed() {
    const feed = $("feed");
    $("total").textContent = posts.length ? posts.length + "통" : "";
    feed.textContent = "";
    if (!posts.length) {
      const e = el("div", "empty");
      e.innerHTML = "<b>아직 도착한 마음이 없어요</b>첫 번째 비둘기를 날려 보세요.";
      feed.appendChild(e);
      return;
    }
    for (const p of posts) {
      const art = el("article", "note" + (!firstLoad && !seen.has(p.id) ? " fresh" : ""));
      const meta = el("div", "meta");
      meta.append(el("span", "stamp", fmtDate(p.date)), el("span", "place", p.place));

      const sub = el("div", "sub");
      const by = el("span", "by");
      const nickBtn = el("button", "nick" + (p.mine ? " self" : ""), p.nickname + (p.mine ? " (나)" : ""));
      nickBtn.type = "button";
      if (p.mine) nickBtn.disabled = true;
      else {
        nickBtn.title = "쪽지 보내기";
        nickBtn.setAttribute("aria-label", p.nickname + "에게 쪽지 보내기");
        nickBtn.addEventListener("click", () => {
          if (!me) return needLogin();
          openReply = openReply === p.id ? null : p.id;
          renderFeed();
          const t = $("r-" + p.id); if (t) t.focus();
        });
      }
      by.append(nickBtn, el("span", null, "· " + ago(p.createdAt)));
      sub.appendChild(by);

      if (p.mine) {
        const isArmed = armed === p.id;
        const del = el("button", "link" + (isArmed ? " confirm" : ""), isArmed ? "정말 삭제할까요?" : "삭제");
        del.type = "button";
        del.addEventListener("click", () => onDelete(p.id));
        sub.appendChild(del);
      }
      art.append(meta, el("p", "body", p.text), sub);
      if (openReply === p.id) art.appendChild(replyBox(p));
      feed.appendChild(art);
    }
    posts.forEach((p) => seen.add(p.id));
    firstLoad = false;
  }

  function replyBox(p) {
    const f = el("form", "reply");
    f.appendChild(el("span", "to", p.nickname + "에게 쪽지"));
    const ta = el("textarea"); ta.id = "r-" + p.id; ta.maxLength = 300;
    ta.placeholder = "혹시 저일까요? 그날 저도 거기 있었어요 :)";
    ta.value = drafts[p.id] || "";
    ta.addEventListener("input", () => { drafts[p.id] = ta.value; });
    const foot = el("div", "foot");
    const msg = el("span", "rule");
    const b = el("button", "btn sky", "쪽지 날리기"); b.type = "submit";
    foot.append(msg, b);
    f.append(ta, foot);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = ta.value.trim();
      if (!text) { msg.textContent = "내용을 적어 주세요."; return; }
      b.disabled = true;
      try {
        await api("POST", "/api/messages", { to: p.authorId, text, postId: p.id });
        delete drafts[p.id]; openReply = null; renderFeed();
        flash($("status"), "쪽지가 날아갔어요! 답장은 쪽지함에서 확인하세요.");
        loadConvs();
      } catch (e) { msg.textContent = e.message; }
      finally { b.disabled = false; }
    });
    return f;
  }

  async function onDelete(id) {
    if (armed !== id) { armed = id; renderFeed(); return; }
    armed = null;
    try { await api("DELETE", "/api/posts/" + encodeURIComponent(id)); }
    catch (e) { flash($("status"), e.message); }
    loadPosts();
  }

  $("compose").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("send"), st = $("status");
    btn.disabled = true; st.textContent = "";
    try {
      await api("POST", "/api/posts", { date: $("f-date").value, place: $("f-place").value, text: $("f-text").value });
      $("f-place").value = ""; $("f-text").value = ""; $("count").textContent = "0/300";
      flash(st, "비둘기가 날아갔어요!");
      loadPosts();
    } catch (e) { st.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  // ---------- 쪽지함 ----------
  async function loadConvs() {
    if (!me) return;
    try {
      const next = await api("GET", "/api/conversations");
      if (JSON.stringify(next) === JSON.stringify(convs)) return; // 바뀐 게 없으면 화면 그대로 (쓰던 답장 유지)
      convs = next; renderInbox();
    }
    catch (e) { /* 다음 새로고침 때 다시 시도 */ }
  }

  function renderInbox() {
    const unread = convs.reduce((n, c) => n + c.messages.filter((m) => !m.mine && m.createdAt > lastSeenInbox).length, 0);
    const badge = $("inbox-badge");
    if (unread && tab !== "inbox") { badge.textContent = unread; badge.hidden = false; } else badge.hidden = true;
    if (tab !== "inbox") return;

    const box = $("threads");
    box.querySelectorAll("textarea[data-key]").forEach((t) => { drafts["t-" + t.dataset.key] = t.value; });
    const focusedKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    box.textContent = "";
    $("thread-total").textContent = convs.length ? convs.length + "명과의 대화" : "";

    if (!me) {
      const e = el("div", "empty"); e.innerHTML = "<b>로그인하면 쪽지함이 열려요</b>위에서 가입하거나 로그인해 주세요.";
      box.appendChild(e); return;
    }
    if (!convs.length) {
      const e = el("div", "empty");
      e.innerHTML = "<b>아직 쪽지가 없어요</b>피드에서 글쓴이 닉네임을 누르면 쪽지를 보낼 수 있어요.";
      box.appendChild(e); return;
    }
    const wrap = el("div", "list"); wrap.style.marginTop = "0";
    for (const c of convs) {
      const card = el("div", "thread");
      card.appendChild(el("span", "who", c.otherNickname));
      const bub = el("div", "bubbles");
      for (const m of c.messages) {
        const bb = el("div", "bub " + (m.mine ? "me" : "them"));
        if (m.about && m.about.place) bb.appendChild(el("div", "about", fmtDate(m.about.date) + " · " + m.about.place + " 글을 보고"));
        bb.append(m.text);
        bb.appendChild(el("small", null, (m.mine ? "나" : c.otherNickname) + " · " + ago(m.createdAt)));
        bub.appendChild(bb);
      }
      card.appendChild(bub);
      const f = el("form");
      const ta = el("textarea"); ta.maxLength = 300; ta.placeholder = "답장 쓰기"; ta.dataset.key = c.otherId;
      ta.value = drafts["t-" + c.otherId] || "";
      ta.setAttribute("aria-label", c.otherNickname + "에게 답장");
      const sb = el("button", "btn", "보내기"); sb.type = "submit";
      const msg = el("span", "rule");
      f.append(ta, sb);
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const text = ta.value.trim(); if (!text) return;
        sb.disabled = true;
        try {
          await api("POST", "/api/messages", { to: c.otherId, text });
          delete drafts["t-" + c.otherId]; ta.value = "";
          await loadConvs();
        } catch (e) { msg.textContent = e.message; }
        finally { sb.disabled = false; }
      });
      card.append(f, msg);
      wrap.appendChild(card);
      if (focusedKey === c.otherId) setTimeout(() => ta.focus(), 0);
    }
    box.appendChild(wrap);
  }

  // ---------- 시작 ----------
  (async () => {
    try { me = await api("GET", "/api/me"); } catch (e) { me = null; }
    renderGate();
    await loadPosts();
    await loadConvs();
    renderInbox();
    // 새 글·새 쪽지를 주기적으로 불러오기
    setInterval(() => {
      if (document.hidden) return;
      if (!openReply) loadPosts();
      loadConvs();
    }, 8000);
  })();
})();
