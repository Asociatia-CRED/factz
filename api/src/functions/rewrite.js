"use strict";
/* POST /api/rewrite — „Rescrie cu AI” din editor: aplică o indicație a editorului pe ciornă,
   fără să adauge fapte noi. Folosește același model ca asistentul (setările AI_* din Azure). */
const { app } = require("@azure/functions");
const L = require("../lib");

const AI_BASE = () => String(process.env.AI_ENDPOINT || "").trim().replace(/\/responses\/?$/, "").replace(/\/+$/, "");
const AI_KEY = () => String(process.env.AI_KEY || "").trim();
const MODEL = () => String(process.env.AI_DEPLOYMENT || "factz-writer").trim();
const clip = (s, n) => String(s || "").trim().slice(0, n);
const roFix = s => String(s || "").replace(/ş/g, "ș").replace(/Ş/g, "Ș").replace(/ţ/g, "ț").replace(/Ţ/g, "Ț");
function cleanBody(html) {
  return String(html || "").replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?!\/?(p|h2|h3|ul|ol|li|blockquote|strong|em|br|a)\b)[^>]*>/gi, "")
    .replace(/\son\w+=("[^"]*"|'[^']*'|\S+)/gi, "").slice(0, 60000);
}
const INSTR = `Ești editorul factz.ro, site românesc de știri verificate pentru publicul tânăr. Primești o ciornă (titlu, rezumat, 3 idei „Pe scurt”, corp HTML), lista surselor și o INDICAȚIE de la editor.
Aplică EXACT indicația și nimic altceva. Reguli obligatorii:
- Nu adăuga fapte, nume, cifre, date, citate sau context care nu sunt deja în ciornă. Poți doar reformula, scurta, reordona, clarifica sau elimina.
- Păstrează sensul, atribuirile și nuanțele (o estimare rămâne estimare, un „dacă” rămâne „dacă”).
- Română corectă, cu diacriticele ș, ț, ă, â, î. Ton clar, neutru, fără clickbait.
- Corpul rămâne HTML cu doar <p>, <h2>, <h3>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <br>; păstrează linkurile existente.
- Titlul: cel mult 110 caractere. Fiecare idee „Pe scurt”: cel mult 140 de caractere.
- Câmpurile pe care indicația nu le privește le întorci neschimbate.
- Dacă indicația cere informații care nu sunt în ciornă, nu le inventa: explică în „note” ce lipsește.
„note”: o frază scurtă, în română, despre ce ai schimbat (sau ce nu s-a putut face).`;
const S = t => ({ type: t });
const schema = { type: "object", additionalProperties: false, required: ["title", "dek", "tldr", "body", "note"],
  properties: { title: S("string"), dek: S("string"), tldr: { type: "array", items: S("string") }, body: S("string"), note: S("string") } };

app.http("rewrite", {
  methods: ["POST"], authLevel: "anonymous", route: "rewrite",
  handler: async (req, context) => {
    try {
      const me = await L.resolveMember(L.principal(req), await L.readCol("users"));
      if (L.rank(me) < 1) throw L.httpError(403, "Doar redacția poate folosi rescrierea.", "forbidden");
      if (!AI_BASE() || !AI_KEY()) throw L.httpError(500, "Rescrierea nu e configurată: adaugă în Azure (Static Web App > Environment variables) setările AI_ENDPOINT, AI_KEY și AI_DEPLOYMENT, cu aceleași valori ca în GitHub.", "config");
      if (!(await L.rateLimit(req, "rewrite", 40, 60))) throw L.httpError(429, "Prea multe rescrieri într-o oră. Încearcă puțin mai târziu.", "rate_limited");
      const b = await req.json().catch(() => ({}));
      const instruction = clip(b.instruction, 600);
      if (instruction.length < 3) throw L.httpError(400, "Scrie ce vrei să schimbe asistentul.", "invalid");
      const d = b.draft || {};
      const draft = { title: clip(d.title, 200), dek: clip(d.dek, 600), tldr: (d.tldr || []).map(t => clip(t, 300)).slice(0, 3), body: clip(d.body, 60000) };
      if (draft.title.length + draft.body.length < 20) throw L.httpError(400, "Ciorna e goală; scrie întâi textul.", "invalid");
      const input = `INDICAȚIA EDITORULUI: ${instruction}\n\nSURSE (doar pentru context, nu adăuga informații din titlurile lor):\n${clip(d.sources, 3000) || "(nespecificate)"}\n\nCIORNA:\nTITLU: ${draft.title}\nREZUMAT: ${draft.dek}\nPE SCURT:\n${draft.tldr.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nCORP (HTML):\n${draft.body}`;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 38000);
      let r, j;
      try {
        r = await fetch(`${AI_BASE()}/responses`, { method: "POST", signal: ctl.signal, headers: { "api-key": AI_KEY(), "content-type": "application/json" },
          body: JSON.stringify({ model: MODEL(), instructions: INSTR, input, reasoning: { effort: "low" }, max_output_tokens: 9000, text: { format: { type: "json_schema", name: "rescriere", strict: true, schema } } }) });
        j = await r.json().catch(() => ({}));
      } catch (e) { throw L.httpError(504, e.name === "AbortError" ? "Rescrierea a durat prea mult. Încearcă o indicație mai scurtă sau pe o bucată mai mică de text." : "Nu am putut contacta modelul AI.", "unavailable"); }
      finally { clearTimeout(timer); }
      if (!r.ok) throw L.httpError(502, `Modelul AI a răspuns cu o eroare: ${clip((j.error && j.error.message) || r.status, 200)}`, "unavailable");
      const txt = j.output_text || (j.output || []).flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
      let out; try { out = JSON.parse(txt); } catch { throw L.httpError(502, "Modelul AI nu a întors un răspuns valid. Încearcă din nou.", "unavailable"); }
      return L.json(200, {
        title: roFix(clip(out.title, 200)), dek: roFix(clip(out.dek, 600)), tldr: (out.tldr || []).map(t => roFix(clip(t, 300))).slice(0, 3),
        body: roFix(cleanBody(out.body)), note: roFix(clip(out.note, 400)),
      });
    } catch (e) { return L.fail(e, context); }
  },
});
