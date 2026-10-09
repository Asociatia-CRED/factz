"use strict";
/* /api/push — notificări pe telefon/calculator („Ultima oră”).
   Setări în Azure: VAPID_PUBLIC_KEY și VAPID_PRIVATE_KEY (se generează din Studio > Setări). */
const { app } = require("@azure/functions");
const crypto = require("crypto");
const L = require("../lib");

const PUB = () => String(process.env.VAPID_PUBLIC_KEY || "").trim();
const PRIV = () => String(process.env.VAPID_PRIVATE_KEY || "").trim();
const configured = () => !!(PUB() && PRIV());
const key = endpoint => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
let wp = null;
function webpush(subject) {
  if (!configured()) throw L.httpError(500, "Notificările nu sunt configurate: lipsesc VAPID_PUBLIC_KEY și VAPID_PRIVATE_KEY în Azure.", "config");
  if (!wp) wp = require("web-push");
  wp.setVapidDetails(subject, PUB(), PRIV());
  return wp;
}
async function listSubs() {
  const t = []; for (const [id, d] of Object.entries(await L.readCol(L.PUSH))) if (d && d.sub && d.sub.endpoint) t.push({ id, ...d }); return t;
}

app.http("push", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "push",
  handler: async (req, context) => {
    try {
      if (req.method === "GET") return L.json(200, { configured: configured(), publicKey: PUB() });
      const b = await req.json().catch(() => ({}));

      if (b.action === "subscribe") {
        const s = b.sub || {}, ep = String(s.endpoint || ""), k = s.keys || {};
        if (!/^https:\/\/[^\s]{10,800}$/.test(ep) || typeof k.p256dh !== "string" || typeof k.auth !== "string" || k.p256dh.length > 200 || k.auth.length > 100) throw L.httpError(400, "Abonare invalidă.", "invalid");
        if (!(await L.rateLimit(req, "push", 10, 60))) throw L.httpError(429, "Prea multe încercări. Mai încearcă peste puțin timp.", "rate_limited");
        await L.putDoc(L.PUSH, key(ep), { sub: { endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth } }, createdAt: Date.now() });
        return L.json(200, { ok: true });
      }
      if (b.action === "unsubscribe") {
        const ep = String(b.endpoint || ""); if (ep) await L.delDoc(L.PUSH, key(ep));
        return L.json(200, { ok: true });
      }

      // de aici încolo, doar redacția
      const me = await L.resolveMember(L.principal(req), await L.readCol("users"));
      if (L.rank(me) < 2) throw L.httpError(403, "Doar editorii pot trimite notificări.", "forbidden");
      if (b.action === "stats") return L.json(200, { configured: configured(), subscribers: (await listSubs()).length });
      if (b.action === "send") {
        const id = String(b.id || ""); if (!L.ID_RE.test(id)) throw L.httpError(400, "Articol invalid.", "invalid");
        const a = await L.getDoc("articles", id);
        if (!L.isLive(a)) throw L.httpError(400, "Notificarea se poate trimite doar pentru un articol publicat.", "invalid");
        const site = (await L.getDoc("settings", "site")) || {};
        const subject = /@/.test(site.contactEmail || "") ? `mailto:${site.contactEmail}` : (process.env.SITE_URL || "https://factz.ro");
        const w = webpush(subject);
        const payload = JSON.stringify({ title: a.breaking ? "Ultima oră | factz.ro" : "factz.ro", body: String(a.title).slice(0, 160), url: `/articol/${encodeURIComponent(a.slug)}`, tag: "a-" + id });
        const subs = await listSubs();
        let sent = 0, removed = 0, failed = 0;
        for (let i = 0; i < subs.length; i += 25) {
          await Promise.all(subs.slice(i, i + 25).map(async s => {
            try { await w.sendNotification(s.sub, payload, { TTL: 6 * 3600, urgency: a.breaking ? "high" : "normal" }); sent++; }
            catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await L.delDoc(L.PUSH, s.id); removed++; } else { failed++; context.error(e); } }
          }));
        }
        await L.mutate("articles", id, cur => ({ ...(cur || a), pushedAt: Date.now(), pushCount: sent }));
        return L.json(200, { ok: true, sent, removed, failed });
      }
      throw L.httpError(400, "Acțiune necunoscută.", "invalid");
    } catch (e) { return L.fail(e, context); }
  },
});
