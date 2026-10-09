// Trimiterea newsletterului factz.ro — rulează din GitHub Actions în fiecare dimineață.
// Site-ul face toată treaba (alege știrile, construiește e-mailul, trimite); scriptul doar îl cheamă
// în tranșe mici, cu pauze, ca să respecte limita de trimitere a Azure (30 de e-mailuri pe minut).
const SITE = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const TOKEN = (process.env.AGENT_TOKEN || "").trim();
const FORCE = /^(1|true|da|yes)$/i.test(String(process.env.FORCE || ""));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!SITE || !TOKEN) { console.error("Lipsește SITE_URL sau AGENT_TOKEN (aceleași setări ca la asistentul AI)."); process.exit(1); }

const started = Date.now();
let total = 0, confirms = 0, rounds = 0, failures = 0;
while (Date.now() - started < 50 * 60000) {
  rounds++;
  let j;
  try {
    const r = await fetch(`${SITE}/api/newsletter`, { method: "POST", headers: { "x-agent-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ action: "batch", force: FORCE }) });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  } catch (e) {
    failures++; log("EROARE:", e.message);
    if (failures >= 3 || /ACS_CONNECTION_STRING|AGENT_TOKEN/.test(e.message)) process.exit(1);
    await sleep(30000); continue;
  }
  failures = 0;
  total += j.sent || 0; confirms += j.confirms || 0;
  if (j.note) log(j.note);
  (j.errors || []).forEach(e => log("Nu s-a putut trimite:", e));
  log(`Tranșa ${rounds}: ${j.sent || 0} newslettere, ${j.confirms || 0} confirmări, rămase ${j.remaining || 0}`);
  if (j.done) break;
  await sleep(j.throttled ? 65000 : 20000);
}
log(`Gata: ${total} newslettere și ${confirms} e-mailuri de confirmare trimise.`);
