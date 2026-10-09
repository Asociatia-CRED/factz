"use strict";
/* /articol/... — aceeași pagină ca restul site-ului, dar cu titlul, rezumatul și coperta articolului
   scrise direct în HTML. Așa apar previzualizări corecte pe WhatsApp, Facebook, Instagram, X și în Google.
   Azure trimite aici cererile pentru /articol/* (vezi staticwebapp.config.json) și adresa originală în x-ms-original-url. */
const { app } = require("@azure/functions");
const L = require("../lib");

const SITE = () => String(process.env.SITE_URL || "https://factz.ro").trim().replace(/\/+$/, "");
const attr = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
let SHELL = null, SHELL_AT = 0;

// pagina de bază (index.html), luată de la site-ul însuși; se ține în memorie 5 minute
async function shell(req) {
  if (SHELL && Date.now() - SHELL_AT < 5 * 60000) return SHELL;
  const origins = [];
  try { origins.push(new URL(req.url).origin); } catch {}
  try { origins.push(new URL(req.headers.get("x-ms-original-url")).origin); } catch {}
  origins.push(SITE());
  for (const o of [...new Set(origins)]) {
    try {
      const r = await fetch(`${o}/index.html`, { headers: { "user-agent": "factz-page/1.0", accept: "text/html" } });
      const t = r.ok ? await r.text() : "";
      if (t.includes('id="app"') && t.includes("</head>")) { SHELL = t; SHELL_AT = Date.now(); return t; }
    } catch {}
  }
  if (SHELL) return SHELL;
  return null;
}
function setMeta(html, sel, tag) {
  const re = new RegExp(`<meta\\s+${sel}[^>]*>`, "i");
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `${tag}\n</head>`);
}

app.http("page", {
  methods: ["GET", "HEAD"], authLevel: "anonymous", route: "page",
  handler: async (req, context) => {
    let path = "/";
    try { path = new URL(req.headers.get("x-ms-original-url") || req.headers.get("x-original-url") || req.url).pathname; } catch {}
    const q = new URL(req.url).searchParams.get("p"); if (q) path = q;
    const slug = decodeURIComponent((path.match(/^\/articol\/([^/?#]+)/) || [])[1] || "");
    let html = null;
    try { html = await shell(req); } catch (e) { context.error(e); }
    try {
      const site = SITE();
      let a = null;
      if (slug) { const arts = await L.readCol("articles"); a = Object.values(arts).find(x => x.slug === slug && L.isLive(x)) || null; }
      if (!html) {
        // rezervă: dacă pagina de bază nu se poate citi, încărcăm site-ul din browser
        const t = a ? attr(a.title) : "factz.ro";
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          body: `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${t}</title><meta property="og:title" content="${t}"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script>fetch("/index.html").then(r=>r.text()).then(h=>{document.open();document.write(h);document.close();});</script></body></html>` };
      }
      if (!a) return { status: slug ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" }, body: html };

      const cats = await L.readCol("categories"), users = await L.readCol("users");
      const url = `${site}/articol/${encodeURIComponent(a.slug)}`;
      const title = `${a.seoTitle || a.title} | factz.ro`;
      const desc = (a.seoDesc || a.dek || (a.tldr || []).filter(Boolean).join(" ") || plain(a.body).slice(0, 200)).slice(0, 300);
      const mc = L.mediaContainer(), base = mc ? mc.url.replace(/\/+$/, "") : "";
      const imgId = a.seoImageId || a.coverId;
      const image = imgId ? (/^https:\/\//.test(imgId) ? imgId : base ? `${base}/${imgId}` : "") : `${site}/og-default.png`;
      const author = users[a.authorId] && !users[a.authorId].bot ? users[a.authorId].name : "Redacția factz.ro";
      const published = new Date(a.publishedAt || a.publishAt || a.createdAt || Date.now()).toISOString();
      const modified = new Date(a.updatedAt || a.publishedAt || Date.now()).toISOString();
      const ld = {
        "@context": "https://schema.org", "@type": a.format === "opinie" ? "OpinionNewsArticle" : "NewsArticle",
        headline: String(a.title).slice(0, 110), description: desc, image: image ? [image] : undefined,
        datePublished: published, dateModified: modified, inLanguage: "ro", mainEntityOfPage: url,
        articleSection: (cats[a.categoryId] || {}).name || undefined,
        author: [{ "@type": author === "Redacția factz.ro" ? "Organization" : "Person", name: author }],
        publisher: { "@type": "NewsMediaOrganization", name: "factz.ro", url: site, logo: { "@type": "ImageObject", url: `${site}/icon-512.png` } },
      };
      html = html.replace(/<title>[^<]*<\/title>/i, `<title>${attr(title)}</title>`);
      html = setMeta(html, 'name="description"', `<meta name="description" content="${attr(desc)}">`);
      html = setMeta(html, 'property="og:title"', `<meta property="og:title" content="${attr(a.title)}">`);
      html = setMeta(html, 'property="og:description"', `<meta property="og:description" content="${attr(desc)}">`);
      html = setMeta(html, 'property="og:type"', `<meta property="og:type" content="article">`);
      html = setMeta(html, 'property="og:url"', `<meta property="og:url" content="${attr(url)}">`);
      if (image) html = setMeta(html, 'property="og:image"', `<meta property="og:image" content="${attr(image)}">`);
      html = setMeta(html, 'name="twitter:card"', `<meta name="twitter:card" content="summary_large_image">`);
      html = setMeta(html, 'property="article:published_time"', `<meta property="article:published_time" content="${published}">`);
      html = html.replace("</head>", `<link rel="canonical" href="${attr(url)}">\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n</head>`);
      return { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" }, body: html };
    } catch (e) {
      context.error(e);
      return { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, body: html || "<!doctype html><title>factz.ro</title>" };
    }
  },
});
