// Asistentul de redacție factz.ro
// Rulează din GitHub Actions: citește sursele RSS, alege subiectele importante, scrie ciorne cu AI
// și le trimite în studio ca „În revizuire”. NU publică nimic singur.
import crypto from "node:crypto";

const SITE = (process.env.SITE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.AGENT_TOKEN || "";
const AI_BASE = (process.env.AI_ENDPOINT || "").replace(/\/responses\/?$/, "").replace(/\/+$/, "");
const AI_KEY = process.env.AI_KEY || "";
const MODEL = process.env.AI_DEPLOYMENT || "factz-writer";
const UA = "Mozilla/5.0 (compatible; factz-asistent/1.0; +https://factz.ro)";
const errors = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

for (const [k, v] of Object.entries({ SITE_URL: SITE, AGENT_TOKEN: TOKEN, AI_ENDPOINT: AI_BASE, AI_KEY })) {
  if (!v) { console.error(`Lipsește setarea ${k}. Vezi README, secțiunea „Asistentul AI”.`); process.exit(1); }
}

/* ---------- utilitare ---------- */
const hash = s => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
const strip = s => decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
async function get(url, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: ctl.signal, redirect: "follow" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
async function site(method, body) {
  const r = await fetch(`${SITE}/api/agent`, { method, headers: { "x-agent-token": TOKEN, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `site HTTP ${r.status}`); e.code = j.code; throw e; }
  return j;
}
async function ai(instructions, input, schema, maxTokens) {
  const r = await fetch(`${AI_BASE}/responses`, {
    method: "POST", headers: { "api-key": AI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, instructions, input, reasoning: { effort: "low" }, max_output_tokens: maxTokens, text: { format: { type: "json_schema", name: "rezultat", strict: true, schema } } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`AI HTTP ${r.status}: ${(j.error && j.error.message) || "eroare"}`);
  const txt = j.output_text || (j.output || []).flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
  return JSON.parse(txt);
}

/* ---------- RSS / Atom ---------- */
function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    const tag = n => { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? m[1] : ""; };
    let link = strip(tag("link"));
    if (!/^https?:/.test(link)) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? decode(m[1]) : ""; }
    const date = Date.parse(strip(tag("pubDate") || tag("published") || tag("updated") || tag("dc:date"))) || 0;
    return { source, title: strip(tag("title")), link, summary: strip(tag("description") || tag("summary") || tag("content:encoded")).slice(0, 300), date };
  }).filter(i => i.title && /^https?:/.test(i.link));
}
// Găsește fluxul RSS: acceptă direct adresa fluxului sau doar adresa site-ului.
const isFeed = x => /<(rss|feed|rdf:RDF)[\s>]/i.test(String(x).slice(0, 4000));
async function resolveFeed(src) {
  let url = String(src.url || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let page = "";
  try { page = await get(url); } catch (e) { page = ""; }
  if (page && isFeed(page)) return { url, xml: page };
  const found = [...page.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
    .filter(l => /rel=["']?alternate/i.test(l) && /(rss|atom)\+xml/i.test(l) && !/comment/i.test(l))
    .map(l => (l.match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean)
    .map(h => { try { return new URL(decode(h), url).href; } catch { return null; } }).filter(Boolean);
  const origin = new URL(url).origin;
  const cands = [...new Set([...found, origin + "/feed/", origin + "/rss", origin + "/rss/", origin + "/rss.xml", origin + "/feed.xml", origin + "/feed"])];
  for (const c of cands.slice(0, 9)) {
    try { const x = await get(c); if (isFeed(x)) return { url: c, xml: x }; } catch {}
  }
  throw new Error(page ? "nu am găsit un flux RSS pe site" : "site-ul nu răspunde (posibil blocat pentru roboți)");
}
function articleText(html) {
  let h = String(html).replace(/<(script|style|noscript|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, " ");
  const art = h.match(/<article[\s\S]*?<\/article>/i);
  if (art) h = art[0];
  const ps = (h.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map(strip).filter(p => p.length > 60);
  return ps.join("\n").slice(0, 5000);
}

/* ---------- instrucțiuni pentru AI ---------- */
const PICK = `Ești editorul de serviciu al factz.ro, un site românesc de știri verificate pentru publicul tânăr.
Primești titluri recente din mai multe surse. Grupează titlurile care descriu ACELAȘI eveniment și alege cele mai importante subiecte de interes public
(politică, economie, societate, educație, sănătate, externe, tehnologie, mediu, justiție). Preferă subiectele relatate de mai multe surse.
EVITĂ: bârfe și vedete, accidente și fapte diverse fără interes public, horoscop, conținut sponsorizat, opinii și editoriale, subiecte deja acoperite (lista „deja acoperite”).
Alege exact numărul cerut de subiecte sau mai puține dacă nu există destule subiecte bune. Folosește doar ID-urile primite.`;
const WRITE = `Ești jurnalist la factz.ro. Scrii în limba română, clar, neutru și exact, pentru un public tânăr.
REGULI OBLIGATORII:
1. Folosește NUMAI informațiile din sursele primite. Nu adăuga fapte, cifre, nume, date sau citate care nu apar în surse.
2. Scrie cu cuvintele tale. Nu copia fraze din surse: niciodată mai mult de 8 cuvinte consecutive identice, cu excepția citatelor scurte, marcate și atribuite.
3. Atribuie afirmațiile („potrivit X”, „a declarat Y”). Dacă sursele se contrazic, spune explicit.
4. Fără opinii, fără adjective emoționale, fără clickbait. Titlul e informativ (max. 110 caractere).
5. Corpul articolului: 4–7 paragrafe în HTML, folosind doar <p>, <h2>, <ul><li>, <blockquote> (citate de max. 25 de cuvinte, cu sursa).
6. „tldr”: exact 3 idei scurte (max. 140 de caractere fiecare), care se înțeleg fără restul articolului.
7. „checklist”: 2–5 lucruri concrete pe care editorul trebuie să le verifice în surse înainte de publicare (cifre, nume, declarații).
8. Alege categoria doar din lista primită.
9. Dacă subiectul vine dintr-o investigație sau un material exclusiv al unei singure publicații (de exemplu Recorder, RISE Project, Snoop, Context),
   scrie doar un rezumat scurt (2–3 paragrafe), spune clar din primul paragraf că este o investigație a publicației respective și încheie
   cu o frază care îndeamnă cititorul să citească materialul complet la sursă. Nu reproduce structura sau detaliile exclusive ale investigației.`;
const pickSchema = { type: "object", additionalProperties: false, required: ["topics"], properties: { topics: { type: "array", items: { type: "object", additionalProperties: false, required: ["item_ids", "why"], properties: { item_ids: { type: "array", items: { type: "integer" } }, why: { type: "string" } } } } } };
const writeSchema = { type: "object", additionalProperties: false, required: ["title", "dek", "tldr", "body", "category_id", "tags", "checklist"], properties: {
  title: { type: "string" }, dek: { type: "string" }, tldr: { type: "array", items: { type: "string" } }, body: { type: "string" },
  category_id: { type: "string" }, tags: { type: "array", items: { type: "string" } }, checklist: { type: "array", items: { type: "string" } } } };

/* ---------- rularea ---------- */
async function main() {
  const cfg = await site("GET");
  const { config } = cfg;
  if (!config.enabled) { log("Asistentul e oprit din studio."); return site("POST", { action: "log", found: 0, created: 0, note: "Oprit din studio" }); }
  const left = Math.max(0, Math.min(config.perRun || 2, (config.maxPerDay || 10) - (cfg.todayCount || 0)));
  if (!left) { log("Limita zilnică a fost atinsă."); return site("POST", { action: "log", found: 0, created: 0, note: "Limita zilnică atinsă" }); }

  const seen = new Set(cfg.seen || []);
  let items = [];
  const feeds = [];
  for (const s of config.sources || []) {
    try {
      const f = await resolveFeed(s);
      const got = parseFeed(f.xml, s.name);
      log(`${s.name}: ${got.length} articole (${f.url})`); items.push(...got);
      feeds.push(`${s.name}: ${got.length}`);
    } catch (e) { errors.push(`Sursa ${s.name} (${s.url}): ${e.message}`); log("EROARE", s.name, e.message); }
  }
  const cutoff = Date.now() - 30 * 3600000;
  const uniq = new Set();
  items = items.filter(i => { const k = hash(i.link.replace(/[?#].*$/, "").replace(/\/$/, "")); if (uniq.has(k)) return false; uniq.add(k); return true; });
  items = items.filter(i => (!i.date || i.date > cutoff) && !seen.has(hash(i.link)))
    .sort((a, b) => b.date - a.date).slice(0, 150);
  log(`Articole noi de analizat: ${items.length}`);
  if (!items.length) return site("POST", { action: "log", found: 0, created: 0, errors, note: "Nimic nou în surse. " + feeds.join(", ") });

  const list = items.map((i, n) => `${n} | ${i.source} | ${i.title}${i.summary ? " — " + i.summary.slice(0, 140) : ""}`).join("\n");
  const pick = await ai(PICK, `Alege cel mult ${left} subiecte.\n\nDEJA ACOPERITE (nu le alege din nou):\n${(cfg.recentTitles || []).map(t => "- " + t).join("\n") || "(niciunul)"}\n\nTITLURI NOI (id | sursa | titlu — rezumat):\n${list}`, pickSchema, 3000);
  const topics = (pick.topics || []).slice(0, left);
  const titles = [];
  for (const t of topics) {
    const group = [...new Set(t.item_ids)].map(n => items[n]).filter(Boolean).slice(0, 4);
    if (!group.length) continue;
    const texts = [];
    for (const it of group) {
      let text = "";
      try { text = articleText(await get(it.link)); } catch (e) { errors.push(`Nu am putut citi ${it.link}: ${e.message}`); }
      texts.push(`SURSA: ${it.source}\nTITLU: ${it.title}\nLINK: ${it.link}\nTEXT:\n${text || it.summary}`);
    }
    try {
      const d = await ai(WRITE + (config.extra ? `\nINDICAȚII SUPLIMENTARE DE LA REDACȚIE: ${config.extra}` : ""),
        `CATEGORII DISPONIBILE (id: nume):\n${cfg.categories.map(c => `${c.id}: ${c.name}`).join("\n")}\n\n${texts.join("\n\n---\n\n")}`, writeSchema, 6000);
      d.sources = group.map(i => ({ name: i.source, title: i.title, url: i.link }));
      const r = await site("POST", { action: "draft", draft: d });
      titles.push(d.title); log("Ciornă creată:", d.title, r.id);
      await site("POST", { action: "seen", keys: group.map(i => hash(i.link)) });
    } catch (e) {
      errors.push(`Ciorna „${(t.why || "").slice(0, 60)}”: ${e.message}`); log("EROARE la scriere", e.message);
      if (e.code === "limit" || e.code === "disabled") break;
    }
  }
  await site("POST", { action: "log", found: items.length, created: titles.length, titles, errors, note: feeds.join(", ") });
}

main().catch(async e => {
  console.error("Rularea a eșuat:", e.message);
  try { await site("POST", { action: "log", found: 0, created: 0, errors: [...errors, e.message], note: "Rulare eșuată" }); } catch {}
  process.exit(1);
});
