// Asistentul de redacție factz.ro — v2
// Rulează din GitHub Actions. Etape: (1) citește sursele, (2) alege subiectele, (3) analizează sursele
// (același eveniment? câte surse originale? contradicții?), (4) scrie ciorna, (5) o verifică față de surse.
// Trimite ciornele în studio ca „În revizuire”. NU publică nimic singur.
import crypto from "node:crypto";

const SITE = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const TOKEN = (process.env.AGENT_TOKEN || "").trim();
const AI_BASE = (process.env.AI_ENDPOINT || "").trim().replace(/\/responses\/?$/, "").replace(/\/+$/, "");
const AI_KEY = (process.env.AI_KEY || "").trim();
const MODEL = (process.env.AI_DEPLOYMENT || "factz-writer").trim();
const UA = "Mozilla/5.0 (compatible; factz-asistent/2.0; +https://factz.ro)";
const PER_SOURCE = 12;                 // câte titluri noi luăm din fiecare publicație la o rulare
const INVESTIGATIVE = /recorder|riseproject|snoop|context\.ro/i;
const errors = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

for (const [k, v] of Object.entries({ SITE_URL: SITE, AGENT_TOKEN: TOKEN, AI_ENDPOINT: AI_BASE, AI_KEY })) {
  if (!v) { console.error(`Lipsește setarea ${k}. Vezi README, secțiunea „Asistentul AI”.`); process.exit(1); }
}

/* ---------- utilitare ---------- */
const hash = s => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", bdquo: "„", rdquo: "”", ldquo: "“" };
const decode = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
const strip = s => decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const words = s => strip(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length >= 5);
async function get(url, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*", "accept-language": "ro,en;q=0.5" }, signal: ctl.signal, redirect: "follow" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
async function getImage(url, ms = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/webp,image/jpeg,image/png,image/*;q=0.8" }, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Error("tip de fișier nepotrivit: " + type);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000 || buf.length > 8 * 1024 * 1024) throw new Error("fișier prea mic sau prea mare");
    return { type, buf };
  } finally { clearTimeout(t); }
}
async function site(method, body) {
  const r = await fetch(`${SITE}/api/agent`, { method, headers: { "x-agent-token": TOKEN, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `site HTTP ${r.status}`); e.code = j.code; throw e; }
  return j;
}
async function ai(instructions, input, schema, maxTokens, effort = "medium") {
  // input poate fi text simplu sau o listă de mesaje (text + imagini)
  const r = await fetch(`${AI_BASE}/responses`, {
    method: "POST", headers: { "api-key": AI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, instructions, input, reasoning: { effort }, max_output_tokens: maxTokens, text: { format: { type: "json_schema", name: "rezultat", strict: true, schema } } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`AI HTTP ${r.status}: ${(j.error && j.error.message) || "eroare"}`);
  const txt = j.output_text || (j.output || []).flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
  return JSON.parse(txt);
}
const S = (type, extra = {}) => ({ type, ...extra });
const obj = props => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const arr = items => ({ type: "array", items });

/* ---------- RSS / Atom ---------- */
const isFeed = x => /<(rss|feed|rdf:RDF)[\s>]/i.test(String(x).slice(0, 4000));
async function resolveFeed(src) {
  let url = String(src.url || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let page = "";
  try { page = await get(url); } catch { page = ""; }
  if (page && isFeed(page)) return { url, xml: page };
  const found = [...page.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
    .filter(l => /rel=["']?alternate/i.test(l) && /(rss|atom)\+xml/i.test(l) && !/comment/i.test(l))
    .map(l => (l.match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean)
    .map(h => { try { return new URL(decode(h), url).href; } catch { return null; } }).filter(Boolean);
  const origin = new URL(url).origin;
  const cands = [...new Set([...found, origin + "/feed/", origin + "/rss", origin + "/rss/", origin + "/rss.xml", origin + "/feed.xml", origin + "/feed"])];
  for (const c of cands.slice(0, 9)) { try { const x = await get(c); if (isFeed(x)) return { url: c, xml: x }; } catch {} }
  throw new Error(page ? "nu am găsit un flux RSS pe site" : "site-ul nu răspunde (posibil blocat pentru roboți)");
}
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

/* ---------- extragerea textului articolului ---------- */
const JUNK = /(citește și|citeste si|abonează-te|aboneaza-te|urmărește-ne|urmareste-ne|cookie|newsletter|sursa foto|foto:|video:|publicitate|toate drepturile|politica de confiden|descarcă aplicația|click aici|^\s*(tags?|etichete)\b)/i;
function articleText(html) {
  const raw = String(html);
  // 1) textul oficial din datele structurate (folosit de site-uri pentru Google)
  for (const m of raw.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = o => { if (!o || typeof o !== "object") return ""; if (typeof o.articleBody === "string" && o.articleBody.length > 400) return o.articleBody; for (const v of Object.values(o)) { const r = walk(v); if (r) return r; } return ""; };
      const body = walk(JSON.parse(m[1].trim()));
      if (body) return decode(body).replace(/\s+\n/g, "\n").trim().slice(0, 6000);
    } catch {}
  }
  // 2) paragrafele din <article> sau din pagină, fără liste de linkuri și reclame
  let h = raw.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|iframe|button|figcaption)[\s\S]*?<\/\1>/gi, " ");
  const art = h.match(/<article[\s\S]*?<\/article>/gi);
  const pick = src => (src.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map(p => {
    const text = strip(p), linkText = (p.match(/<a[\s\S]*?<\/a>/gi) || []).map(strip).join(" ");
    return { text, linky: text.length ? linkText.length / text.length : 1 };
  }).filter(x => x.text.length > 60 && x.linky < 0.35 && !JUNK.test(x.text)).map(x => x.text);
  let ps = art ? pick(art.sort((a, b) => b.length - a.length)[0]) : [];
  if (ps.join(" ").length < 600) ps = pick(h);
  const text = ps.join("\n");
  if (text.length >= 400) return text.slice(0, 6000);
  const og = (raw.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i) || [])[1];
  return og ? decode(og) : "";
}

/* ---------- fotografii cu licență liberă ---------- */
// Doar licențe care permit folosirea pe un site de știri, cu menționarea autorului: CC0, domeniu public, CC BY, CC BY-SA.
// Nu folosim niciodată fotografiile din articolele-sursă: aparțin publicațiilor și agențiilor foto.
const okLicense = l => { const s = String(l || "").trim(); return /^(cc0|public domain|pd\b|pdm|cc[ -]by(-sa)?\b)/i.test(s) && !/\b(nc|nd)\b|non-?commercial|no ?deriv/i.test(s); };
const getJson = async url => JSON.parse(await get(url, 15000));
async function commonsSearch(q) {
  const u = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "8", prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1280" });
  const j = await getJson(u);
  return Object.values((j.query || {}).pages || {}).map(p => {
    const ii = (p.imageinfo || [])[0]; if (!ii) return null;
    const m = ii.extmetadata || {}, v = k => strip((m[k] || {}).value || "");
    const thumb = ii.thumburl ? ii.thumburl.replace(/\/\d+px-([^/]+)$/, "/500px-$1") : ii.url;
    return { provider: "Wikimedia Commons", title: String(p.title || "").replace(/^File:/, "").replace(/\.\w+$/, ""), desc: v("ImageDescription").slice(0, 300),
      author: v("Artist").slice(0, 100), license: v("LicenseShortName"), licenseUrl: (m.LicenseUrl || {}).value || "", sourceUrl: ii.descriptionurl,
      url: ii.thumburl || ii.url, thumb, w: ii.width || 0, h: ii.height || 0, mime: ii.mime || "", date: v("DateTimeOriginal").slice(0, 30), nonfree: /true/i.test(v("NonFree")) };
  }).filter(Boolean);
}
async function openverseSearch(q) {
  const j = await getJson("https://api.openverse.org/v1/images/?" + new URLSearchParams({ q, license: "by,by-sa,cc0,pdm", page_size: "8", mature: "false" }));
  return (j.results || []).map(r => ({
    provider: r.source === "wikimedia" ? "Wikimedia Commons" : r.source === "flickr" ? "Flickr" : (r.source || "Openverse"), title: r.title || "", desc: "",
    author: String(r.creator || "").slice(0, 100), license: r.license === "cc0" ? "CC0" : r.license === "pdm" ? "Public domain" : `CC ${String(r.license || "").toUpperCase()} ${r.license_version || ""}`.trim(),
    licenseUrl: r.license_url || "", sourceUrl: r.foreign_landing_url || "", url: r.url, thumb: r.thumbnail || r.url, w: r.width || 0, h: r.height || 0, mime: "", date: "", nonfree: false,
  }));
}
const PHOTO = `Ești editorul foto al factz.ro, site de știri verificate. Primești un articol și fotografii candidate cu licență liberă (numerotate, cu imaginea, titlul și descrierea fiecăreia).
Alege fotografia potrivită pentru coperta articolului sau niciuna (choice = -1). Reguli:
- Dacă articolul e despre o persoană, alege doar o fotografie în care e SIGUR acea persoană (numele apare în titlu sau descriere). Niciodată altă persoană.
- Dacă e despre o instituție, o clădire sau un loc, fotografia trebuie să arate exact acea instituție, clădire sau loc.
- O fotografie generică (de exemplu un spital, o sală de clasă, bancnote) e acceptată doar dacă ilustrează corect tema și nu poate induce în eroare (nu sugerează un eveniment, o persoană sau un loc anume).
- Respinge: imagini cu sigle sau texte ale altor publicații, grafice, capturi de ecran, imagini violente sau șocante, fotografii foarte vechi pentru subiecte actuale, imagini neclare.
- Dacă ai cea mai mică îndoială, alege -1. O copertă lipsă e mai bună decât una greșită.
„alt” = o descriere scurtă, în română, a ce se vede în fotografie (pentru cititorii cu deficiențe de vedere), fără „Imagine cu”.`;
const photoSchema = obj({ choice: S("integer"), alt: S("string"), why: S("string") });
async function findPhoto(art, queries) {
  const seen = new Set(), cands = [];
  for (const q of (queries || []).map(x => String(x || "").trim()).filter(Boolean).slice(0, 3)) {
    const found = (await Promise.allSettled([commonsSearch(q), openverseSearch(q)])).flatMap(r => r.status === "fulfilled" ? r.value : []);
    for (const c of found) {
      const k = String(c.url || "").replace(/\/\d+px-[^/]+$/, "");
      if (!c.url || seen.has(k) || c.nonfree || !okLicense(c.license) || !/^https:\/\//.test(c.sourceUrl || "")) continue;
      if (c.mime && !/jpe?g|png|webp/i.test(c.mime)) continue;
      if (c.w && c.h && (c.w < 800 || c.w / c.h < 1.05 || c.w / c.h > 2.6)) continue; // copertele sunt orizontale
      seen.add(k); cands.push(c);
    }
    if (cands.length >= 10) break;
  }
  if (!cands.length) return null;
  const list = cands.slice(0, 10);
  const text = `ARTICOL:\nTITLU: ${art.title}\nREZUMAT: ${art.dek}\n\nFOTOGRAFII CANDIDATE:\n` + list.map((c, n) => `[${n}] ${c.provider} | ${c.title}${c.desc ? " | " + c.desc.slice(0, 200) : ""}${c.date ? " | data: " + c.date : ""}`).join("\n");
  let pick;
  try {
    // cu imaginile atașate (calitate redusă, cost mic), ca modelul să vadă ce alege
    pick = await ai(PHOTO, [{ role: "user", content: [{ type: "input_text", text }, ...list.map(c => ({ type: "input_image", image_url: c.thumb, detail: "low" }))] }], photoSchema, 1500, "low");
  } catch (e) {
    log("Alegerea cu imagini nu a mers, încerc doar cu text:", e.message);
    pick = await ai(PHOTO + "\nNu vezi imaginile, doar titlurile și descrierile: alege doar dacă descrierea arată clar subiectul.", text, photoSchema, 1500, "low");
  }
  const c = list[pick.choice];
  if (!c) return null;
  const img = await getImage(c.url);
  const author = c.author && !/^(unknown|necunoscut|anonymous)$/i.test(c.author) ? c.author : "autor necunoscut";
  return { data: img.buf.toString("base64"), contentType: img.type, alt: String(pick.alt || "").slice(0, 200), title: c.title, author, license: c.license, licenseUrl: c.licenseUrl, sourceUrl: c.sourceUrl, credit: `Foto: ${author} / ${c.provider}, ${c.license}` };
}

/* ---------- instrucțiuni ---------- */
const PICK = `Ești editorul de serviciu al factz.ro, site românesc de știri verificate pentru publicul tânăr.
Primești titluri recente, fiecare cu publicația din care vine. Sarcina ta:
1. GRUPEAZĂ titlurile care descriu ACELAȘI EVENIMENT, chiar dacă sunt formulate diferit sau vin din publicații diferite.
   Exemplu: „Guvernul a aprobat bugetul” (HotNews) și „Bolojan: bugetul trece azi prin ședință” (G4Media) = același eveniment.
2. ALEGE subiecte de interes public (politică, economie, societate, educație, sănătate, externe, tehnologie, mediu, justiție).
3. PREFERĂ categoric subiectele relatate de CEL PUȚIN DOUĂ PUBLICAȚII DIFERITE. Mai multe articole din aceeași publicație NU înseamnă mai multe surse.
4. EVITĂ: vedete și bârfe, accidente și fapte diverse fără interes public, horoscop, sport minor, conținut sponsorizat, opinii, subiecte din lista „deja acoperite”.
5. Într-un grup pune doar articole despre exact același eveniment, nu despre teme înrudite.
Folosește doar ID-urile primite.`;
const ANALYZE = `Ești redactorul de verificare al factz.ro. Primești articole-sursă numerotate (cu publicația fiecăruia).
Stabilește, strict pe baza textelor:
- "main_ids": articolele care descriu EXACT evenimentul principal (același incident, aceeași declarație, aceeași decizie). Dacă sursele descriu incidente diferite (alte locuri, alte date, alte cifre), păstrează-l doar pe cel mai bine documentat.
- "context_ids": articole utile doar ca fundal (aceeași temă, alt eveniment). Pot fi zero.
- "independent_origins": câte surse ORIGINALE independente există. Dacă o publicație scrie „a declarat la X”, „potrivit X”, „citat de X”, atunci originalul e X, nu publicația care preia. Același interviu sau comunicat preluat de mai multe site-uri = 1.
- "kind": "stire" dacă ai cel puțin 2 surse originale independente; "declaratie" dacă totul vine dintr-o singură declarație/interviu/comunicat; "investigatie" dacă e o investigație sau un material exclusiv al unei singure publicații.
- "event_summary": o frază: cine, ce, când, unde.
- "key_facts": faptele esențiale, fiecare cu ID-urile surselor care îl susțin. Copiază exact cifrele, numele și funcțiile din surse.
- "conflicts": orice contradicție între surse (cifre, nume, date, locuri). Listă goală dacă nu există.
- "uncertain": afirmații condiționale, estimări, informații neconfirmate sau atribuite vag.`;
const WRITE = `Ești jurnalist la factz.ro. Scrii în limba română corectă (cu diacriticele ș, ț, ă, â, î), clar, neutru și exact, pentru un public tânăr.

REGULI DE FOND (obligatorii):
1. Folosește NUMAI faptele din „FAPTE VERIFICATE” și din textele surselor. Nu adăuga nimic ce nu apare acolo: fără nume, cifre, funcții, date sau explicații inventate.
2. Scrie cu cuvintele tale. Niciodată mai mult de 8 cuvinte consecutive identice cu o sursă, cu excepția citatelor scurte (max. 25 de cuvinte), între ghilimele „…” și atribuite.
3. Păstrează exact condițiile și nuanțele: o estimare rămâne estimare, un „dacă” rămâne „dacă”. Dacă sursele se contrazic, spune explicit („cifrele diferă între surse: …”).
4. Fără formulări vagi care ascund lipsa informației („agenția de profil”, „surse”, „experții”). Fie numești instituția/persoana, fie omiți.

REGULI DE FORMĂ:
5. TITLUL (max. 110 caractere) e precis și atribuie corect: o declarație e a persoanei, nu a instituției.
   Bine: „Secretarul de stat Cristian Bușoi: facturile la curent ar putea crește cu 20–22% în iarnă”. Rău: „Ministerul Energiei estimează scumpiri”.
6. PRIMA FRAZĂ spune evenimentul (cine, ce, când), NU începe cu „Potrivit…”.
   Bine: „Bulgaria cere consultări cu România și Turcia după ce două nave au fost lovite de drone în largul coastelor sale.”
7. Atribuie sursa o singură dată pentru un set de informații, apoi scrie natural. Nu pune „potrivit X” în fiecare frază și nu înlănțui atribuiri („a declarat la X, potrivit Y”): numește direct sursa originală.
8. Fiecare paragraf aduce informație NOUĂ. Ideile din „tldr” nu se repetă cuvânt cu cuvânt în corp.
9. STRUCTURA corpului, în HTML (<p>, <h2>, <ul><li>, <blockquote>):
   - 1–2 paragrafe cu evenimentul și detaliile principale;
   - 1–3 paragrafe cu cifre, declarații, detalii;
   - dacă există context în surse: <h2>Context</h2> + 1–2 paragrafe (cu atribuire);
   - dacă sursele permit: <h2>Ce urmează</h2> sau <h2>Ce înseamnă pentru tine</h2> + 1 paragraf.
   Calcule simple sunt permise doar cu cifrele din surse și doar dacă sunt corecte, marcate „(calcul factz.ro)”.
10. LUNGIMEA depinde de tip: „stire” 5–8 paragrafe; „declaratie” 2–4 paragrafe, titlul de forma „Persoana: esența declarației”;
    „investigatie” 2–3 paragrafe, prima frază spune clar că e o investigație a publicației X, ultima îndeamnă la citirea materialului complet; nu reproduce detaliile exclusive.
11. EVITĂ: „în contextul în care”, „este important de menționat”, „nu în ultimul rând”, „a mai precizat că” repetat, „sursa citată”, adjective emoționale, clickbait.
12. „tldr”: exact 3 idei scurte (max. 140 de caractere fiecare), fiecare înțeleasă singură.
13. „checklist”: tot ce editorul trebuie să verifice în surse: TOATE numele și funcțiile oficialilor, toate cifrele, toate condițiile și estimările, orice detaliu din „uncertain”.
14. Alege categoria doar din lista primită.
15. „photo_queries”: 2–3 căutări scurte pentru o fotografie de copertă cu licență liberă: întâi numele exact al persoanei principale sau al instituției/locului (de ex. „Ilie Bolojan”, „Palatul Parlamentului”), apoi o căutare generică în engleză pentru temă (de ex. „hospital corridor”, „euro banknotes”).`;
const VERIFY = `Ești editorul de verificare al factz.ro. Primești o ciornă și sursele ei. Compară FIECARE afirmație din ciornă cu sursele.
- Elimină sau corectează orice afirmație care nu e susținută de surse (nume, funcții, cifre, date, locuri, cauze, citate).
- Verifică titlul: e precis, atribuie corect, nu generalizează?
- Elimină repetițiile și formulările vagi. Păstrează structura și stilul.
- Dacă descoperi că sursele descriu evenimente diferite amestecate, păstrează doar evenimentul principal.
Întoarce versiunea CORECTATĂ completă (title, dek, tldr, body, checklist).
În "issues" pune DOAR problemele care rămân și pe care editorul trebuie să le rezolve el (contradicții între surse, informații neconfirmate, nesiguranțe). Listă goală dacă ciorna e curată.`;

const pickSchema = obj({ topics: arr(obj({ item_ids: arr(S("integer")), why: S("string") })) });
const analyzeSchema = obj({
  main_ids: arr(S("integer")), context_ids: arr(S("integer")), independent_origins: S("integer"),
  kind: S("string", { enum: ["stire", "declaratie", "investigatie"] }), event_summary: S("string"),
  key_facts: arr(obj({ fact: S("string"), ids: arr(S("integer")) })), conflicts: arr(S("string")), uncertain: arr(S("string")),
});
const draftProps = { title: S("string"), dek: S("string"), tldr: arr(S("string")), body: S("string"), checklist: arr(S("string")) };
const writeSchema = obj({ ...draftProps, category_id: S("string"), tags: arr(S("string")), photo_queries: arr(S("string")) });
const verifySchema = obj({ ...draftProps, issues: arr(S("string")) });

/* ---------- rularea ---------- */
async function main() {
  const cfg = await site("GET");
  const { config } = cfg;
  if (!config.enabled) { log("Asistentul e oprit din studio."); return site("POST", { action: "log", found: 0, created: 0, note: "Oprit din studio" }); }
  const left = Math.max(0, Math.min(config.perRun || 2, (config.maxPerDay || 10) - (cfg.todayCount || 0)));
  if (!left) { log("Limita zilnică a fost atinsă."); return site("POST", { action: "log", found: 0, created: 0, note: "Limita zilnică atinsă" }); }

  // 1) citirea surselor, cu cotă pe publicație
  const seen = new Set(cfg.seen || []);
  const cutoff = Date.now() - 30 * 3600000;
  const uniq = new Set(); const all = []; const feeds = [];
  for (const s of config.sources || []) {
    try {
      const f = await resolveFeed(s);
      let got = parseFeed(f.xml, s.name).filter(i => { const k = hash(i.link.replace(/[?#].*$/, "").replace(/\/$/, "")); if (uniq.has(k)) return false; uniq.add(k); return true; });
      got = got.filter(i => !i.date || i.date > cutoff).sort((a, b) => b.date - a.date);
      const fresh = got.filter(i => !seen.has(hash(i.link))).slice(0, PER_SOURCE);
      all.push(...got.slice(0, 30)); feeds.push(`${s.name}: ${fresh.length}`);
      fresh.forEach(i => { i.fresh = true; });
      log(`${s.name}: ${got.length} recente, ${fresh.length} noi (${f.url})`);
    } catch (e) { errors.push(`Sursa ${s.name} (${s.url}): ${e.message}`); log("EROARE", s.name, e.message); }
  }
  const items = all.filter(i => i.fresh);
  log(`Titluri noi de analizat: ${items.length} din ${new Set(items.map(i => i.source)).size} publicații`);
  if (!items.length) return site("POST", { action: "log", found: 0, created: 0, errors, note: "Nimic nou în surse. " + feeds.join(", ") });

  // 2) alegerea subiectelor
  const list = items.map((i, n) => `${n} | ${i.source} | ${i.title}${i.summary ? " — " + i.summary.slice(0, 140) : ""}`).join("\n");
  const pick = await ai(PICK, `Alege cel mult ${left + 2} subiecte (vom păstra cele mai bune ${left}).\n\nDEJA ACOPERITE (nu le alege din nou):\n${(cfg.recentTitles || []).map(t => "- " + t).join("\n") || "(niciunul)"}\n\nTITLURI NOI (id | publicație | titlu — rezumat):\n${list}`, pickSchema, 4000, "low");
  let topics = (pick.topics || []).map(t => {
    const group = [...new Set(t.item_ids)].map(n => items[n]).filter(Boolean);
    return { ...t, group, outlets: new Set(group.map(i => host(i.link))).size };
  }).filter(t => t.group.length);
  // regula din cod: întâi subiectele din mai multe publicații; cel mult unul dintr-o singură publicație pe rulare
  topics.sort((a, b) => b.outlets - a.outlets);
  const chosen = []; let singles = 0;
  for (const t of topics) { if (chosen.length >= left) break; if (t.outlets < 2) { if (singles >= 1) continue; singles++; } chosen.push(t); }

  const titles = [];
  for (const t of chosen) {
    try {
      // 3) sursele: grupul + până la 2 articole de context din alte publicații, pe aceeași temă
      const kw = new Set(t.group.flatMap(i => words(i.title)));
      const ctx = all.filter(i => !t.group.includes(i) && !t.group.some(g => host(g.link) === host(i.link)) && words(i.title).filter(w => kw.has(w)).length >= 2).slice(0, 2);
      const cand = [...t.group.slice(0, 5), ...ctx];
      for (const it of cand) { try { it.text = articleText(await get(it.link)); } catch (e) { it.text = ""; errors.push(`Nu am putut citi ${host(it.link)}: ${e.message}`); } if (!it.text) it.text = it.summary; }
      const srcBlock = cand.map((it, n) => `[${n}] PUBLICAȚIA: ${it.source} (${host(it.link)})\nTITLU: ${it.title}\nTEXT:\n${it.text}`).join("\n\n---\n\n");

      // 4) analiza: același eveniment? câte surse originale? contradicții?
      const an = await ai(ANALYZE, srcBlock, analyzeSchema, 5000, "medium");
      const main = [...new Set(an.main_ids)].map(n => cand[n]).filter(Boolean);
      if (!main.length) { errors.push(`„${t.group[0].title.slice(0, 60)}”: sursele nu descriu un eveniment clar`); continue; }
      const outlets = new Set(main.map(i => host(i.link)));
      let kind = an.kind;
      if (outlets.size < 2 || an.independent_origins < 2) kind = main.some(i => INVESTIGATIVE.test(i.link)) ? "investigatie" : "declaratie";
      const context = [...new Set(an.context_ids)].map(n => cand[n]).filter(i => i && !main.includes(i));
      const used = [...main, ...context];
      const usedBlock = used.map((it, n) => `[${n}] ${context.includes(it) ? "CONTEXT" : "SURSĂ"} — ${it.source}\nTITLU: ${it.title}\nTEXT:\n${it.text}`).join("\n\n---\n\n");
      const facts = an.key_facts.map(f => `- ${f.fact}`).join("\n");

      // 5) scrierea
      const d = await ai(WRITE + (config.extra ? `\n\nINDICAȚII DE LA REDACȚIE: ${config.extra}` : ""),
        `TIP: ${kind}\nEVENIMENT: ${an.event_summary}\n\nFAPTE VERIFICATE:\n${facts}\n\nCONTRADICȚII ÎNTRE SURSE:\n${an.conflicts.join("\n") || "(niciuna)"}\n\nINFORMAȚII NESIGURE (trebuie redate ca atare și puse în checklist):\n${an.uncertain.join("\n") || "(niciuna)"}\n\nCATEGORII DISPONIBILE (id: nume):\n${cfg.categories.map(c => `${c.id}: ${c.name}`).join("\n")}\n\nSURSE:\n${usedBlock}`,
        writeSchema, 8000, "medium");

      // 6) verificarea față de surse
      const v = await ai(VERIFY, `CIORNA:\nTITLU: ${d.title}\nREZUMAT: ${d.dek}\nTLDR: ${d.tldr.join(" | ")}\nCORP:\n${d.body}\nCHECKLIST: ${d.checklist.join(" | ")}\n\nSURSE:\n${usedBlock}`, verifySchema, 8000, "medium");
      const plain = s => String(s || "").replace(/<[^>]+>/g, "").trim().length;
      const verifiedOk = plain(v.body) >= 250 && plain(v.body) >= plain(d.body) * 0.4;
      if (!verifiedOk) (v.issues = v.issues || []).push("Verificarea automată a scurtat prea mult textul; s-a păstrat varianta inițială. Citește-o cu atenție.");
      const draft = {
        title: v.title || d.title, dek: v.dek || d.dek, tldr: (v.tldr && v.tldr.length ? v.tldr : d.tldr), body: verifiedOk ? v.body : d.body,
        checklist: [...new Set([...(v.checklist || []), ...(d.checklist || [])])].slice(0, 10),
        flags: [...new Set([...an.conflicts.map(c => "Contradicție între surse: " + c), ...(v.issues || [])])].slice(0, 8),
        kind, outlets: outlets.size, category_id: d.category_id, tags: d.tags,
        sources: [...main.map(i => ({ name: i.source, title: i.title, url: i.link })), ...context.map(i => ({ name: i.source + " (context)", title: i.title, url: i.link }))],
      };
      // 7) fotografia de copertă (opțional): doar cu licență liberă, aleasă cu grijă; editorul o aprobă
      if (config.photos !== false) {
        try {
          const ph = await findPhoto(draft, d.photo_queries);
          if (ph) { draft.photo = ph; draft.checklist = [...draft.checklist.slice(0, 9), `Fotografia de copertă e propusă de asistent (${ph.credit}). Verifică dacă arată exact subiectul; o poți schimba sau scoate.`]; log("Fotografie propusă:", ph.credit); }
          else log("Nicio fotografie potrivită; ciorna rămâne cu coperta generată.");
        } catch (e) { errors.push(`Fotografie pentru „${draft.title.slice(0, 50)}”: ${e.message}`); log("EROARE fotografie:", e.message); }
      }
      const r = await site("POST", { action: "draft", draft });
      titles.push(`${draft.title} [${kind}, ${outlets.size} publicații]`); log("Ciornă creată:", draft.title, `(${kind}, ${outlets.size} publicații)`, r.id);
      await site("POST", { action: "seen", keys: t.group.map(i => hash(i.link)) });
    } catch (e) {
      errors.push(`„${(t.why || "").slice(0, 60)}”: ${e.message}`); log("EROARE", e.message);
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
