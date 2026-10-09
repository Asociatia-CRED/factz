"use strict";
/* GET /api/sitemap — harta site-ului pentru Google (indicată în robots.txt). */
const { app } = require("@azure/functions");
const L = require("../lib");

const SITE = () => String(process.env.SITE_URL || "https://factz.ro").trim().replace(/\/+$/, "");
const x = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const iso = ts => new Date(ts).toISOString();

app.http("sitemap", {
  methods: ["GET"], authLevel: "anonymous", route: "sitemap",
  handler: async (req, context) => {
    try {
      const site = SITE(), now = Date.now();
      const [arts, cats, topics] = await Promise.all([L.readCol("articles"), L.readCol("categories"), L.readCol("topics")]);
      const live = Object.values(arts).filter(L.isLive).filter(a => a.slug);
      const last = live.reduce((m, a) => Math.max(m, a.updatedAt || a.publishedAt || 0), 0) || now;
      const urls = [
        { loc: `${site}/`, lastmod: last },
        { loc: `${site}/ultimele`, lastmod: last },
        ...Object.values(cats).filter(c => c.slug).map(c => ({ loc: `${site}/categorie/${encodeURIComponent(c.slug)}`, lastmod: last })),
        ...Object.values(topics).filter(t => t.slug).map(t => ({ loc: `${site}/dosar/${encodeURIComponent(t.slug)}` })),
        ...["despre", "contact", "termeni", "confidentialitate", "cookies", "accesibilitate"].map(p => ({ loc: `${site}/${p}` })),
        ...live.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).map(a => ({ loc: `${site}/articol/${encodeURIComponent(a.slug)}`, lastmod: a.updatedAt || a.publishedAt })),
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${x(u.loc)}</loc>${u.lastmod ? `<lastmod>${iso(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
      return { status: 200, body: xml, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } };
    } catch (e) { return L.fail(e, context); }
  },
});
