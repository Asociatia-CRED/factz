"use strict";
/* GET /api/rss — fluxul RSS al factz.ro: ultimele 30 de articole publicate. */
const { app } = require("@azure/functions");
const L = require("../lib");

const SITE = () => String(process.env.SITE_URL || "https://factz.ro").trim().replace(/\/+$/, "");
const x = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

app.http("rss", {
  methods: ["GET"], authLevel: "anonymous", route: "rss",
  handler: async (req, context) => {
    try {
      const site = SITE();
      const [arts, cats] = await Promise.all([L.readCol("articles"), L.readCol("categories")]);
      const mc = L.mediaContainer(), base = mc ? mc.url.replace(/\/+$/, "") : "";
      const t = a => a.publishedAt || a.publishAt || a.createdAt || 0;
      const live = Object.values(arts).filter(L.isLive).filter(a => a.slug).sort((a, b) => t(b) - t(a)).slice(0, 30);
      const items = live.map(a => {
        const url = `${site}/articol/${encodeURIComponent(a.slug)}`;
        const pts = (a.tldr || []).filter(Boolean);
        const desc = `${a.dek ? `<p>${x(a.dek)}</p>` : ""}${pts.length ? `<ul>${pts.map(p => `<li>${x(p)}</li>`).join("")}</ul>` : ""}<p><a href="${x(url)}">Citește articolul complet pe factz.ro</a></p>`;
        const img = a.coverId && base && !/^https:/.test(a.coverId) ? `${base}/${a.coverId}` : "";
        return `    <item>
      <title>${x(a.title)}</title>
      <link>${x(url)}</link>
      <guid isPermaLink="true">${x(url)}</guid>
      <pubDate>${new Date(t(a)).toUTCString()}</pubDate>
      ${(cats[a.categoryId] || {}).name ? `<category>${x(cats[a.categoryId].name)}</category>` : ""}
      <description>${x(desc)}</description>${img ? `\n      <enclosure url="${x(img)}" type="${/\.png$/i.test(img) ? "image/png" : /\.webp$/i.test(img) ? "image/webp" : "image/jpeg"}" length="0"/>` : ""}
    </item>`;
      }).join("\n");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>factz.ro</title>
    <link>${site}/</link>
    <description>Știri verificate, pe scurt sau pe larg, cu sursele la vedere.</description>
    <language>ro</language>
    <atom:link href="${site}/api/rss" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date(live.length ? t(live[0]) : Date.now()).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
      return { status: 200, body: xml, headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" } };
    } catch (e) { return L.fail(e, context); }
  },
});
