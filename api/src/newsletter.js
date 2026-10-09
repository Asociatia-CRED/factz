"use strict";
/* Newsletterul factz.ro: construiește e-mailul zilei și îl trimite prin Azure Communication Services (Email).
   Setări în Azure (Static Web App > Environment variables):
     ACS_CONNECTION_STRING  conexiunea resursei Communication Services (obligatoriu pentru trimitere)
     NEWSLETTER_FROM        adresa expeditorului (implicit DoNotReply@factz.ro)
     SITE_URL               adresa site-ului (implicit https://factz.ro) */
const crypto = require("crypto");
const L = require("./lib");

const SITE = () => String(process.env.SITE_URL || "https://factz.ro").trim().replace(/\/+$/, "");
const FROM = () => String(process.env.NEWSLETTER_FROM || "DoNotReply@factz.ro").trim();
const configured = () => !!String(process.env.ACS_CONNECTION_STRING || "").trim();
const UNSUB = "%%UNSUB%%";
const MAX_ARTICLES = 8;

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plain = html => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const pubTime = a => a.publishedAt || a.publishAt || a.updatedAt || a.createdAt || 0;
const newToken = () => crypto.randomBytes(18).toString("hex");
function sameToken(a, b) {
  a = String(a || ""); b = String(b || "");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
// textul de pe etichetele colorate: alb sau închis, după contrast
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return "#ffffff";
  const lum = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const Y = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return (1.05 / (Y + 0.05)) >= ((Y + 0.05) / 0.05) ? "#ffffff" : "#16141F";
}
const DATE_RO = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", weekday: "long", day: "numeric", month: "long" });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- conținutul ---------- */
// Știrile publicate în ultimele 24 de ore (sau, la test, cele mai noi dacă nu e nimic recent).
function pickArticles(all, now, { fallback = false } = {}) {
  const live = Object.entries(all.articles || {}).map(([id, a]) => ({ ...a, id })).filter(L.isLive).sort((a, b) => pubTime(b) - pubTime(a));
  let list = live.filter(a => now - pubTime(a) <= L.DAY && pubTime(a) <= now);
  if (!list.length && fallback) list = live.slice(0, 5);
  // întâi știrile marcate „Ultima oră” sau „În prim-plan”, apoi restul, cele mai noi primele
  list.sort((a, b) => (+!!b.breaking + +!!b.featured) - (+!!a.breaking + +!!a.featured) || pubTime(b) - pubTime(a));
  return list.slice(0, MAX_ARTICLES);
}

function buildIssue(all, mediaBase, now, opts = {}) {
  const arts = pickArticles(all, now, opts);
  if (!arts.length) return null;
  const site = SITE(), cats = all.categories || {};
  const url = a => `${site}/articol/${encodeURIComponent(a.slug || "")}`;
  const coverUrl = a => !a.coverId ? "" : /^https:\/\//.test(a.coverId) ? a.coverId : (mediaBase ? `${mediaBase.replace(/\/+$/, "")}/${a.coverId}` : "");
  const date = cap(DATE_RO.format(new Date(now)));
  const top = arts[0];
  const subject = (arts.length > 1 ? `${top.title} și încă ${arts.length - 1} ${arts.length - 1 === 1 ? "știre" : "știri"}` : top.title).slice(0, 140);
  const pre = ((top.tldr || []).find(Boolean) || top.dek || "").slice(0, 140);

  const item = (a, i) => {
    const c = cats[a.categoryId] || {}, col = /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "#4B4DFF";
    const pts = (a.tldr || []).filter(Boolean).slice(0, 3);
    const img = i === 0 ? coverUrl(a) : "";
    const label = a.format === "opinie" ? "Opinie" : (c.name || "Știri");
    return `<tr><td style="padding:0 0 14px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:2px solid #16141F;border-radius:18px;border-collapse:separate">
        ${img ? `<tr><td style="padding:0"><a href="${esc(url(a))}"><img src="${esc(img)}" width="560" alt="${esc(a.coverAlt || "")}" style="display:block;width:100%;max-width:560px;height:auto;border-radius:16px 16px 0 0;border:0"></a></td></tr>` : ""}
        <tr><td style="padding:18px 20px 20px">
          <span style="display:inline-block;background:${col};color:${inkOn(col)};font:700 12px/1 Arial,Helvetica,sans-serif;padding:6px 10px;border-radius:8px">${esc(label)}</span>${a.breaking ? ` <span style="display:inline-block;background:#D92D20;color:#ffffff;font:700 12px/1 Arial,Helvetica,sans-serif;padding:6px 10px;border-radius:8px">Ultima oră</span>` : ""}
          <h2 style="margin:12px 0 8px;font:800 ${i === 0 ? 24 : 19}px/1.2 Arial,Helvetica,sans-serif;color:#16141F"><a href="${esc(url(a))}" style="color:#16141F;text-decoration:none">${esc(a.title)}</a></h2>
          ${pts.length ? `<ul style="margin:0 0 12px;padding:0 0 0 18px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#2A2738">${pts.map(p => `<li style="margin:0 0 4px">${esc(p)}</li>`).join("")}</ul>` : a.dek ? `<p style="margin:0 0 12px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#2A2738">${esc(a.dek)}</p>` : ""}
          <a href="${esc(url(a))}" style="font:700 14px/1 Arial,Helvetica,sans-serif;color:#4B4DFF">Citește articolul</a>
        </td></tr>
      </table></td></tr>`;
  };

  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F2F1F8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F1F8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="padding:0 4px 18px">
    <a href="${esc(site)}"><img src="${esc(site)}/email-logo.png" width="180" height="36" alt="factz.ro" style="display:block;border:0"></a>
    <p style="margin:14px 0 0;font:700 14px/1.4 Arial,Helvetica,sans-serif;color:#55516A">${esc(date)}</p>
    <p style="margin:2px 0 0;font:15px/1.4 Arial,Helvetica,sans-serif;color:#16141F">${arts.length === 1 ? "O știre verificată" : `${arts.length} știri verificate`} din ultimele 24 de ore.</p>
  </td></tr>
  ${arts.map(item).join("")}
  <tr><td style="padding:8px 4px 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#55516A">
    <p style="margin:0 0 8px"><b style="color:#16141F">Spill the facts, not the tea.</b> Fiecare articol arată cine l-a scris, cine l-a verificat și pe ce surse se bazează.</p>
    <p style="margin:0 0 8px">Primești acest e-mail pentru că te-ai abonat pe factz.ro. <a href="${UNSUB}" style="color:#4B4DFF">Dezabonează-te</a> oricând, cu un singur clic.</p>
    <p style="margin:0">factz.ro, un proiect editorial al Asociației Centrul pentru Reformă, Echitate și Democrație (C.R.E.D.).</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  const text = [`factz.ro, ${date}`, `${arts.length === 1 ? "O știre verificată" : `${arts.length} știri verificate`} din ultimele 24 de ore.`, ""]
    .concat(arts.flatMap(a => [a.title.toUpperCase(), ...((a.tldr || []).filter(Boolean).slice(0, 3).map(p => "- " + p)), (a.tldr || []).length ? "" : plain(a.dek), url(a), ""]))
    .concat(["Spill the facts, not the tea.", `Dezabonare: ${UNSUB}`]).filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n");

  return { subject, html, text, count: arts.length, ids: arts.map(a => a.id) };
}

/* ---------- e-mailul de confirmare a abonării ---------- */
function confirmEmail(sub) {
  const site = SITE();
  const link = `${site}/api/newsletter?a=confirm&id=${encodeURIComponent(sub.id)}&t=${encodeURIComponent(sub.token)}`;
  const subject = "Confirmă abonarea la newsletterul factz.ro";
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#F2F1F8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:2px solid #16141F;border-radius:18px;border-collapse:separate"><tr><td style="padding:28px 26px;font:16px/1.5 Arial,Helvetica,sans-serif;color:#16141F">
  <img src="${esc(site)}/email-logo.png" width="160" height="32" alt="factz.ro" style="display:block;border:0;margin:0 0 20px">
  <h1 style="margin:0 0 12px;font:800 24px/1.2 Arial,Helvetica,sans-serif">Mai e un pas</h1>
  <p style="margin:0 0 20px">Apasă butonul de mai jos ca să primești în fiecare dimineață, la 7, știrile verificate din ultimele 24 de ore.</p>
  <p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#C6F21B;color:#16141F;border:2px solid #16141F;border-radius:12px;padding:13px 22px;font:800 16px/1 Arial,Helvetica,sans-serif;text-decoration:none">Confirmă abonarea</a></p>
  <p style="margin:0;font-size:13px;color:#55516A">Dacă nu tu ai cerut abonarea, ignoră acest e-mail. Fără confirmare nu primești nimic, iar adresa se șterge automat după 30 de zile.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Mai e un pas\n\nDeschide linkul de mai jos ca să primești în fiecare dimineață, la 7, știrile verificate din ultimele 24 de ore:\n${link}\n\nDacă nu tu ai cerut abonarea, ignoră acest e-mail. Fără confirmare nu primești nimic, iar adresa se șterge automat după 30 de zile.`;
  return { subject, html, text };
}

/* ---------- trimiterea ---------- */
let _client = null;
function client() {
  if (!configured()) throw L.httpError(500, "Newsletterul nu e configurat: lipsește setarea ACS_CONNECTION_STRING în Azure (Static Web App > Environment variables).", "config");
  if (!_client) { const { EmailClient } = require("@azure/communication-email"); _client = new EmailClient(String(process.env.ACS_CONNECTION_STRING).trim()); }
  return _client;
}
const unsubUrl = sub => `${SITE()}/api/newsletter?a=unsub&id=${encodeURIComponent(sub.id)}&t=${encodeURIComponent(sub.token || "")}`;
// Trimite un e-mail. Nu așteaptă livrarea: Azure îl pune la coadă și îl livrează în câteva secunde.
// Cu { wait: true } așteaptă (cel mult 25 de secunde) rezultatul real de la Azure: livrat sau eroarea exactă.
async function send(to, { subject, html, text }, unsub, { wait = false, replyTo = "" } = {}) {
  const message = {
    senderAddress: FROM(),
    content: { subject, html: unsub ? html.split(UNSUB).join(esc(unsub)) : html, plainText: unsub ? text.split(UNSUB).join(unsub) : text },
    recipients: { to: [{ address: to }] },
    disableUserEngagementTracking: true,
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(replyTo || "")) message.replyTo = [{ address: replyTo }];
  if (unsub) message.headers = { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  try {
    const poller = await client().beginSend(message);
    if (!wait) return { status: "Queued" };
    const res = await Promise.race([poller.pollUntilDone(), new Promise(r => setTimeout(() => r(null), 25000))]);
    if (!res) return { status: "Running" };
    return { status: res.status || "Unknown", error: res.error ? `${res.error.code || ""} ${res.error.message || ""}`.trim() : "" };
  }
  catch (e) {
    const status = e && (e.statusCode || (e.response && e.response.status));
    if (status === 429) { const er = new Error("Azure a atins limita de trimitere. Reîncerc mai târziu."); er.code = "throttled"; throw er; }
    if (status === 400 && message.headers) { delete message.headers; await client().beginSend(message); return { status: "Queued" }; }
    throw e;
  }
}

module.exports = { SITE, configured, newToken, sameToken, buildIssue, confirmEmail, send, unsubUrl, inkOn };
