"use strict";
/* /api/newsletter
   - linkurile din e-mailuri: ?a=confirm (confirmă abonarea) și ?a=unsub (dezabonare, șterge adresa)
   - redacția (editori): previzualizare și e-mail de test
   - GitHub Actions (cu cheia AGENT_TOKEN): trimiterea zilnică, în tranșe mici */
const { app } = require("@azure/functions");
const crypto = require("crypto");
const L = require("../lib");
const N = require("../newsletter");

const BATCH = 8;                       // câte e-mailuri trimite o cerere (sub limita de timp a funcțiilor)
const PENDING_DAYS = 30;               // abonările neconfirmate se șterg după 30 de zile

function agentOk(req) {
  const want = String(process.env.AGENT_TOKEN || "").trim(), got = String(req.headers.get("x-agent-token") || "").trim();
  return want.length >= 24 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
const redirect = s => ({ status: 302, headers: { location: `/#/newsletter?s=${s}`, "cache-control": "no-store" } });
async function settingsSite() { return (await L.getDoc("settings", "site")) || {}; }
function mediaBase() { const mc = L.mediaContainer(); return mc ? mc.url : ""; }

app.http("newsletter", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "newsletter",
  handler: async (req, context) => {
    try {
      const q = new URL(req.url).searchParams;
      const a = q.get("a");

      /* ---------- linkurile din e-mail ---------- */
      if (a === "confirm" || a === "unsub") {
        const id = String(q.get("id") || ""), t = String(q.get("t") || "");
        if (!L.ID_RE.test(id)) return req.method === "GET" ? redirect("invalid") : L.json(400, { error: "Link invalid." });
        const sub = await L.getDoc("subscribers", id);
        if (a === "unsub") {
          // dezabonarea șterge adresa de tot; un link vechi pentru o adresă deja ștearsă e tot un succes
          if (sub && N.sameToken(sub.token, t)) await L.delDoc("subscribers", id);
          else if (sub) return req.method === "GET" ? redirect("invalid") : L.json(400, { error: "Link invalid." });
          return req.method === "GET" ? redirect("unsubscribed") : L.json(200, { ok: true });
        }
        if (!sub || !N.sameToken(sub.token, t)) return redirect("invalid");
        if (sub.status !== "active") await L.putDoc("subscribers", id, { ...sub, status: "active", confirmedAt: Date.now() });
        return redirect("confirmed");
      }
      if (req.method === "GET") return L.json(400, { error: "Cerere invalidă." });

      const body = await req.json().catch(() => ({}));
      const now = Date.now();

      /* ---------- redacția: previzualizare și test ---------- */
      if (body.action === "preview" || body.action === "test") {
        const me = await L.resolveMember(L.principal(req), await L.readCol("users"));
        if (L.rank(me) < 2) throw L.httpError(403, "Doar editorii pot vedea newsletterul înainte de trimitere.", "forbidden");
        const issue = N.buildIssue(await L.readAll(), mediaBase(), now, { fallback: true });
        if (!issue) throw L.httpError(400, "Nu e niciun articol publicat încă, deci newsletterul ar fi gol.", "invalid");
        if (body.action === "preview") return L.json(200, { subject: issue.subject, html: issue.html.split("%%UNSUB%%").join("#"), count: issue.count });
        const to = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw L.httpError(400, "Scrie o adresă de e-mail validă pentru test.", "invalid");
        const res = await N.send(to, { ...issue, subject: "[Test] " + issue.subject }, `${N.SITE()}/#/newsletter`, { wait: true });
        return L.json(200, { ok: true, count: issue.count, status: res.status, error: res.error || "", from: process.env.NEWSLETTER_FROM || "DoNotReply@factz.ro" });
      }

      /* ---------- redacția: retrimite e-mailul de confirmare unui abonat ---------- */
      if (body.action === "resend") {
        const me = await L.resolveMember(L.principal(req), await L.readCol("users"));
        if (L.rank(me) < 2) throw L.httpError(403, "Doar editorii pot retrimite confirmarea.", "forbidden");
        const id = String(body.id || ""); if (!L.ID_RE.test(id)) throw L.httpError(400, "Abonat invalid.", "invalid");
        const sub = await L.getDoc("subscribers", id);
        if (!sub || !sub.email) throw L.httpError(404, "Abonatul nu mai există.", "not_found");
        if (sub.status === "active") return L.json(200, { ok: true, status: "Succeeded", note: "Adresa e deja confirmată." });
        if (!sub.token) sub.token = N.newToken();
        let res;
        try { res = await N.send(sub.email, N.confirmEmail({ ...sub, id }), null, { wait: true }); }
        catch (e) { context.error(e); res = { status: "Failed", error: String((e && e.message) || e).slice(0, 200) }; }
        const ok = res.status === "Succeeded" || res.status === "Running" || res.status === "Queued";
        await L.putDoc("subscribers", id, { ...sub, status: "pending", ...(ok ? { confirmSentAt: now, lastError: undefined } : { lastError: (res.error || res.status).slice(0, 200) }) });
        return L.json(200, { ok: true, status: res.status, error: res.error || "", from: process.env.NEWSLETTER_FROM || "DoNotReply@factz.ro" });
      }

      /* ---------- trimiterea zilnică (GitHub Actions) ---------- */
      if (body.action === "batch") {
        if (!agentOk(req)) throw L.httpError(401, "Cheia AGENT_TOKEN lipsește sau diferă între GitHub și Azure.", "forbidden");
        if (!N.configured()) throw L.httpError(500, "Lipsește setarea ACS_CONNECTION_STRING în Azure (Static Web App > Environment variables).", "config");
        const site = await settingsSite();
        if (site.newsletterOff) return L.json(200, { done: true, sent: 0, remaining: 0, note: "Newsletterul e oprit din studio." });
        const today = L.dayKey(now);
        if (!body.force && L.roHour(now) < 7) return L.json(200, { done: true, sent: 0, remaining: 0, note: "E prea devreme; newsletterul pleacă la 7." });

        // ediția zilei se construiește o singură dată, ca toți abonații să primească același e-mail
        let issue = await L.getDoc("agent", "nl-issue");
        if (!issue || issue.day !== today) {
          const built = N.buildIssue(await L.readAll(), mediaBase(), now);
          issue = built ? { day: today, ...built, builtAt: now } : { day: today, empty: true, builtAt: now };
          await L.putDoc("agent", "nl-issue", issue);
        }

        let subs = Object.entries(await L.readCol("subscribers")).map(([id, s]) => ({ ...s, id }));
        // curățenie: abonările neconfirmate de peste 30 de zile
        const stale = s => s.status !== "active" && s.confirmSentAt && now - s.confirmSentAt > PENDING_DAYS * L.DAY;
        for (const s of subs.filter(stale)) await L.delDoc("subscribers", s.id);
        subs = subs.filter(s => !stale(s) && s.email);
        // abonații vechi (dinainte de confirmare) și cei care n-au primit încă e-mailul de confirmare
        const toConfirm = subs.filter(s => s.status !== "active" && !s.confirmSentAt);
        const toSend = issue.empty ? [] : subs.filter(s => s.status === "active" && s.lastNl !== today);
        let sent = 0, confirms = 0, throttled = false; const errors = [];
        for (const s of [...toConfirm.map(s => ["confirm", s]), ...toSend.map(s => ["issue", s])].slice(0, BATCH)) {
          const [kind, sub] = s;
          try {
            if (!sub.token) sub.token = N.newToken();
            if (kind === "confirm") { await N.send(sub.email, N.confirmEmail(sub)); confirms++; }
            else { await N.send(sub.email, issue, N.unsubUrl(sub)); sent++; }
            const { id, ...doc } = sub;
            await L.putDoc("subscribers", id, kind === "confirm" ? { ...doc, status: doc.status || "pending", confirmSentAt: now } : { ...doc, lastNl: today });
          } catch (e) {
            if (e.code === "throttled") { throttled = true; break; }
            const msg = String(e.message || e).slice(0, 160);
            errors.push(`${sub.email.replace(/^(.).*@/, "$1***@")}: ${msg}`);
            context.error(e);
            // o adresă care dă eroare nu mai e reîncercată azi, ca trimiterea să nu se blocheze în ea
            const { id, ...doc } = sub;
            await L.putDoc("subscribers", id, kind === "confirm" ? { ...doc, status: doc.status || "pending", confirmSentAt: now, lastError: msg } : { ...doc, lastNl: today, lastError: msg });
          }
        }
        const remaining = throttled ? toConfirm.length + toSend.length - sent - confirms - errors.length : Math.max(0, toConfirm.length + toSend.length - Math.min(BATCH, toConfirm.length + toSend.length));
        const st = (await L.getDoc("agent", "nl-state")) || {};
        const day = st.day === today ? st : { day: today, sent: 0, confirms: 0, errors: [] };
        day.sent += sent; day.confirms += confirms; day.errors = [...(day.errors || []), ...errors].slice(-20); day.count = issue.count || 0; day.empty = !!issue.empty; day.subject = issue.subject || ""; day.at = now;
        await L.putDoc("agent", "nl-state", day);
        return L.json(200, { done: remaining === 0, sent, confirms, remaining, throttled, errors, note: issue.empty ? "Nimic publicat în ultimele 24 de ore; nu s-a trimis newsletterul." : "" });
      }
      throw L.httpError(400, "Acțiune necunoscută.", "invalid");
    } catch (e) { return L.fail(e, context); }
  },
});
