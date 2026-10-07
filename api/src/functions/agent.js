"use strict";
/* /api/agent — punctul de legătură cu asistentul de redacție (rulează din GitHub Actions).
   Protejat cu cheia secretă AGENT_TOKEN. Creează DOAR ciorne „În revizuire”; nu publică nimic. */
const { app } = require("@azure/functions");
const crypto = require("crypto");
const L = require("../lib");

const DEFAULTS = {
  enabled: true, maxPerDay: 10, perRun: 2, categories: [],
  sources: [
    { name: "Recorder", url: "https://recorder.ro" },
    { name: "Context", url: "https://context.ro" },
    { name: "RISE Project", url: "https://www.riseproject.ro" },
    { name: "Snoop", url: "https://snoop.ro" },
    { name: "G4Media", url: "https://www.g4media.ro" },
    { name: "HotNews", url: "https://hotnews.ro/feed" },
    { name: "Europa Liberă România", url: "https://romania.europalibera.org" },
    { name: "Profit.ro", url: "https://www.profit.ro" },
    { name: "Ziarul Financiar", url: "https://www.zf.ro" },
    { name: "Panorama", url: "https://panorama.ro" },
    { name: "Edupedu", url: "https://www.edupedu.ro" },
    { name: "Digi24", url: "http://www.digi24.ro/rss/Stiri/Digi24/" },
  ],
  extra: "",
};
const AGENT_USER = "u_agent";
const slug = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
function okToken(req) {
  const want = process.env.AGENT_TOKEN || "", got = req.headers.get("x-agent-token") || "";
  if (want.length < 24 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
const today = () => L.dayKey(Date.now());
const clip = (s, n) => String(s || "").trim().slice(0, n);
function cleanBody(html) {
  // doar etichetele permise; restul e eliminat (pagina mai face o sanitizare la afișare)
  return String(html || "").replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?!\/?(p|h2|h3|ul|ol|li|blockquote|strong|em|br)\b)[^>]*>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "").slice(0, 60000);
}

app.http("agent", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "agent",
  handler: async (req, context) => {
    try {
      if (!okToken(req)) throw L.httpError(401, "Cheia asistentului lipsește sau e greșită (setarea AGENT_TOKEN).", "forbidden");
      const config = { ...DEFAULTS, ...(await L.getDoc("agent", "config") || {}) };
      if (req.method === "GET") {
        const state = await L.getDoc("agent", "state") || { seen: {}, days: {} };
        const cats = await L.readCol("categories");
        const arts = await L.readCol("articles");
        const since = Date.now() - 3 * L.DAY;
        const recent = Object.values(arts).filter(a => (a.createdAt || 0) > since).map(a => a.title).filter(Boolean).slice(-80);
        return L.json(200, {
          config, todayCount: (state.days || {})[today()] || 0, seen: Object.keys(state.seen || {}),
          categories: Object.entries(cats).map(([id, c]) => ({ id, name: c.name })).filter(c => !config.categories.length || config.categories.includes(c.id)),
          recentTitles: recent,
        });
      }
      const body = await req.json().catch(() => ({}));
      const now = Date.now();
      if (body.action === "seen") {
        const keys = (body.keys || []).filter(k => /^[a-f0-9]{16}$/.test(k)).slice(0, 500);
        await L.mutate("agent", "state", cur => {
          const s = cur || { seen: {}, days: {} }; s.seen = s.seen || {};
          keys.forEach(k => { s.seen[k] = now; });
          for (const [k, t] of Object.entries(s.seen)) if (now - t > 14 * L.DAY) delete s.seen[k];
          return s;
        });
        return L.json(200, { ok: true });
      }
      if (body.action === "log") {
        const id = "log-" + now.toString(36);
        await L.putDoc("agent", id, { at: now, found: +body.found || 0, created: +body.created || 0, titles: (body.titles || []).slice(0, 10).map(t => clip(t, 160)), errors: (body.errors || []).slice(0, 20).map(e => clip(e, 300)), note: clip(body.note, 300) });
        const logs = Object.keys(await L.readCol("agent")).filter(k => k.startsWith("log-")).sort();
        for (const k of logs.slice(0, Math.max(0, logs.length - 60))) await L.delDoc("agent", k);
        return L.json(200, { ok: true });
      }
      if (body.action === "draft") {
        if (!config.enabled) throw L.httpError(409, "Asistentul e oprit din studio.", "disabled");
        const state = await L.getDoc("agent", "state") || {};
        if (((state.days || {})[today()] || 0) >= config.maxPerDay) throw L.httpError(429, "Limita zilnică de ciorne a fost atinsă.", "limit");
        const d = body.draft || {};
        const title = clip(d.title, 160);
        if (title.length < 10 || String(d.body || "").length < 200) throw L.httpError(400, "Ciornă incompletă.", "invalid");
        const cats = await L.readCol("categories");
        const categoryId = cats[d.category_id] ? d.category_id : (Object.keys(cats)[0] || "");
        if (!(await L.getDoc("users", AGENT_USER))) await L.putDoc("users", AGENT_USER, { name: "Redacția factz.ro", email: "", role: "jurnalist", active: true, bot: true, bio: "Ciorne pregătite cu asistentul AI și verificate de editori.", createdAt: now });
        const tags = (d.tags || []).map(t => clip(t, 40)).filter(Boolean).slice(0, 6);
        const tagIds = [];
        for (const t of tags) { const s = slug(t); if (!s) continue; tagIds.push(s); if (!(await L.getDoc("tags", s))) await L.putDoc("tags", s, { name: t.toLowerCase() }); }
        const sources = (d.sources || []).slice(0, 8).map(s => `${clip(s.name, 60)}: ${clip(s.title, 160)} – ${clip(s.url, 400)}`).join("\n");
        const body2 = cleanBody(d.body);
        const words = body2.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        const id = "ai" + now.toString(36) + crypto.randomBytes(2).toString("hex");
        const art = {
          title, slug: (slug(title) || "stire") + "-" + crypto.randomBytes(2).toString("hex"), dek: clip(d.dek, 400), body: body2,
          tldr: (d.tldr || []).map(t => clip(t, 200)).filter(Boolean).slice(0, 3), categoryId, topicId: "", tags: tagIds,
          authorId: AGENT_USER, status: "review", format: "text", breaking: false, featured: false, liveEnded: false,
          sources, aiDraft: true, aiChecklist: (d.checklist || []).map(t => clip(t, 200)).slice(0, 8),
          seoTitle: "", seoDesc: "", seoImageId: "", coverId: "", coverAlt: "", coverCaption: "", videoId: "",
          revisions: [], readMin: Math.max(1, Math.round(words / 200)), createdAt: now, updatedAt: now,
        };
        await L.putDoc("articles", id, art);
        await L.mutate("agent", "state", cur => { const s = cur || { seen: {}, days: {} }; s.days = s.days || {}; s.days[today()] = (s.days[today()] || 0) + 1; for (const k of Object.keys(s.days)) if (k < L.dayKey(now - 10 * L.DAY)) delete s.days[k]; return s; });
        return L.json(200, { id });
      }
      throw L.httpError(400, "Acțiune necunoscută.", "invalid");
    } catch (e) { return L.fail(e, context); }
  },
});
