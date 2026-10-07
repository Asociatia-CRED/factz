"use strict";
/* POST /api/write — toate modificările. Fiecare operație verifică cine are voie. */
const { app } = require("@azure/functions");
const L = require("../lib");
const seed = require("../seed.json");

// rangul minim pentru scriere (1 jurnalist, 2 editor, 3 administrator)
const NEED = { agent: 2, articles: 1, liveupdates: 1, media: 1, tags: 1, topics: 2, categories: 2, comments: 2, polls: 2, subscribers: 2, views: 2, reactions: 2, users: 3, settings: 3 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function shiftSeed(src) {
  // aduce datele demo „în prezent”: cel mai nou articol devine de azi
  let maxTs = 0;
  for (const a of Object.values(src.articles || {})) maxTs = Math.max(maxTs, a.publishedAt || a.publishAt || 0);
  const days = Math.max(0, Math.floor((Date.now() - maxTs) / L.DAY));
  const ms = days * L.DAY;
  const TS = new Set(["createdAt", "updatedAt", "publishedAt", "publishAt", "approvedAt", "at"]);
  const shiftKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k) ? new Date(Date.parse(k + "T12:00:00Z") + ms).toISOString().slice(0, 10) : k;
  const walk = (v, parentKey) => {
    if (Array.isArray(v)) return v.map(x => walk(x));
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[parentKey === "days" ? shiftKey(k) : k] = (TS.has(k) && typeof x === "number") ? x + ms : walk(x, k);
      return o;
    }
    return v;
  };
  return walk(src);
}

app.http("write", {
  methods: ["POST"], authLevel: "anonymous", route: "write",
  handler: async (req, context) => {
    try {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") throw L.httpError(400, "Cerere invalidă.", "invalid");
      const { op } = body;
      const p = L.principal(req);
      const users = await L.readCol("users");
      const me = await L.resolveMember(p, users);
      const r = L.rank(me);
      const now = Date.now();
      const id = String(body.id || "");
      if (op !== "bootstrap" && !L.ID_RE.test(id) && op !== "deleteBlob") throw L.httpError(400, "Identificator invalid.", "invalid");

      /* ---------- acțiuni publice (oricine) ---------- */
      if (op === "view") {
        const a = await L.getDoc("articles", id);
        if (!L.isLive(a)) throw L.httpError(404, "Articolul nu există.", "not_found");
        const today = L.dayKey(now), cutoff = L.dayKey(now - 30 * L.DAY);
        const doc = await L.mutate("views", id, cur => {
          const d = cur || { total: 0, days: {} };
          d.total = (d.total || 0) + 1; d.days = d.days || {}; d.days[today] = (d.days[today] || 0) + 1;
          for (const k of Object.keys(d.days)) if (k < cutoff) delete d.days[k];
          return d;
        });
        return L.json(200, { doc });
      }
      if (op === "react") {
        const k = body.k, prev = body.prev || null;
        if (!L.REACTS.includes(k) || (prev && !L.REACTS.includes(prev))) throw L.httpError(400, "Reacție invalidă.", "invalid");
        if (!L.isLive(await L.getDoc("articles", id))) throw L.httpError(404, "Articolul nu există.", "not_found");
        const today = L.dayKey(now), cutoff = L.dayKey(now - 30 * L.DAY);
        const doc = await L.mutate("reactions", id, cur => {
          const d = cur || { counts: {}, days: {} };
          d.counts = d.counts || {}; d.days = d.days || {}; d.days[today] = d.days[today] || {};
          if (prev) { d.counts[prev] = Math.max(0, (d.counts[prev] || 0) - 1); if (d.days[today][prev]) d.days[today][prev]--; }
          if (prev !== k) { d.counts[k] = (d.counts[k] || 0) + 1; d.days[today][k] = (d.days[today][k] || 0) + 1; }
          for (const day of Object.keys(d.days)) if (day < cutoff) delete d.days[day];
          return d;
        });
        return L.json(200, { doc });
      }
      if (op === "vote") {
        const opt = String(body.opt || "");
        const doc = await L.mutate("polls", id, cur => {
          if (!cur || !cur.active || !(cur.options || []).some(o => o.id === opt)) throw L.httpError(400, "Sondajul nu mai e activ.", "invalid");
          cur.votes = cur.votes || {}; cur.votes[opt] = (cur.votes[opt] || 0) + 1; return cur;
        });
        return L.json(200, { doc });
      }

      /* ---------- primul administrator ---------- */
      if (op === "bootstrap") {
        if (!p) throw L.httpError(401, "Intră mai întâi cu contul Microsoft sau GitHub.", "forbidden");
        if (Object.keys(users).length) throw L.httpError(403, "Studioul are deja administrator.", "forbidden");
        const name = String(body.name || "").trim().slice(0, 80) || p.userDetails;
        const uid = "u" + now.toString(36);
        await L.putDoc("users", uid, { name, email: L.isMasked(p.userDetails) ? "" : p.userDetails, authIds: p.userId ? [L.authKey(p)] : [], role: "admin", active: true, bio: "", createdAt: now });
        if (body.demo) {
          const s = shiftSeed(seed);
          const jobs = [];
          for (const [col, docs] of Object.entries(s)) for (const [did, d] of Object.entries(docs)) jobs.push([col, did, d]);
          for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20).map(([c, d, x]) => L.putDoc(c, d, x)));
        } else {
          await L.putDoc("settings", "site", { studioPath: "cn-studio", contactEmail: "", social: {} });
        }
        return L.json(200, { ok: true });
      }

      /* ---------- ștergere fișier media ---------- */
      if (op === "deleteBlob") {
        if (r < 1) throw L.httpError(403, "Nu ai drept să ștergi fișiere.", "forbidden");
        const name = String(body.id || "");
        if (!/^[A-Za-z0-9._-]{1,200}$/.test(name)) throw L.httpError(400, "Fișier invalid.", "invalid");
        const mc = L.mediaContainer(); if (mc) await mc.getBlockBlobClient(name).deleteIfExists();
        return L.json(200, { ok: true });
      }

      /* ---------- set / update / delete ---------- */
      const col = String(body.col || "");
      if (!L.COLS.includes(col) || !["set", "update", "delete"].includes(op)) throw L.httpError(400, "Operație necunoscută.", "invalid");
      const existing = await L.getDoc(col, id);

      // vizitatorii pot doar trimite comentarii și se pot abona la newsletter
      if (r === 0) {
        if (op === "set" && col === "comments" && !existing) {
          const d = body.data || {};
          const a = await L.getDoc("articles", String(d.articleId || ""));
          if (!L.isLive(a)) throw L.httpError(400, "Articolul nu acceptă comentarii.", "invalid");
          const name = String(d.name || "").trim().slice(0, 60), text = String(d.text || "").trim().slice(0, 1500);
          if (name.length < 1 || text.length < 3) throw L.httpError(400, "Completează numele și comentariul.", "invalid");
          const doc = await L.putDoc("comments", id, { articleId: d.articleId, name, text, status: "pending", createdAt: now });
          return L.json(200, { doc });
        }
        if (op === "set" && col === "subscribers" && !existing) {
          const email = String((body.data || {}).email || "").trim().toLowerCase().slice(0, 200);
          if (!EMAIL_RE.test(email)) throw L.httpError(400, "Adresa de e-mail nu pare validă.", "invalid");
          const subs = await L.readCol("subscribers");
          if (!Object.values(subs).some(s => s.email === email)) await L.putDoc("subscribers", id, { email, createdAt: now });
          return L.json(200, { doc: { email, createdAt: now } });
        }
        throw L.httpError(p ? 403 : 401, p ? "Contul tău nu face parte din redacție." : "Intră în studio ca să faci modificări.", "forbidden");
      }
      if (r < (NEED[col] || 3)) throw L.httpError(403, "Rolul tău nu permite această modificare.", "forbidden");

      let next = op === "delete" ? null : op === "set" ? { ...(body.data || {}) } : L.deepMerge(existing, body.data || {});
      if (next) delete next.id;

      // reguli pentru jurnaliști: doar articolele proprii, doar ca ciornă sau trimise la revizuire
      if (r === 1 && col === "articles") {
        if (existing && (existing.authorId !== me.id || !["draft", "review"].includes(existing.status))) throw L.httpError(403, "Poți modifica doar articolele tale aflate în lucru.", "forbidden");
        if (op === "delete" && existing && existing.status !== "draft") throw L.httpError(403, "Poți șterge doar ciornele tale.", "forbidden");
        if (next) {
          if (next.authorId !== me.id) throw L.httpError(403, "Articolul trebuie să fie al tău.", "forbidden");
          if (!["draft", "review"].includes(next.status)) throw L.httpError(403, "Doar editorii aprobă și publică.", "forbidden");
          next.featured = existing ? !!existing.featured : false;
        }
      }
      if (r === 1 && col === "liveupdates") {
        const artId = (next || existing || {}).articleId;
        const a = await L.getDoc("articles", String(artId || ""));
        if (!a || a.authorId !== me.id) throw L.httpError(403, "Poți actualiza doar transmisiile tale.", "forbidden");
      }
      if (col === "users" && next) {
        if (!["admin", "editor", "jurnalist"].includes(next.role)) throw L.httpError(400, "Rol invalid.", "invalid");
        if (id === me.id && (next.role !== "admin" || next.active === false)) throw L.httpError(400, "Nu îți poți scoate singur drepturile de administrator.", "invalid");
        next.email = String(next.email || "").trim();
        if (existing && existing.authIds) next.authIds = existing.authIds; else delete next.authIds;
        delete next.linked;
      }
      if (col === "users" && op === "delete" && id === me.id) throw L.httpError(400, "Nu îți poți șterge propriul cont.", "invalid");

      if (op === "delete") { await L.delDoc(col, id); return L.json(200, { ok: true }); }
      const doc = await L.putDoc(col, id, next);
      return L.json(200, { doc });
    } catch (e) { return L.fail(e, context); }
  },
});
