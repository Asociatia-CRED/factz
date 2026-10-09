"use strict";
/* GET /api/media?id=<fișier> — servește o imagine din Blob Storage prin adresa site-ului,
   ca studioul să o poată folosi în caruselul de Instagram (browserul cere aceeași origine). */
const { app } = require("@azure/functions");
const L = require("../lib");

app.http("media", {
  methods: ["GET"], authLevel: "anonymous", route: "media",
  handler: async (req, context) => {
    try {
      const id = String(new URL(req.url).searchParams.get("id") || "");
      if (!/^[A-Za-z0-9._-]{1,200}\.(jpe?g|png|webp|gif)$/i.test(id)) throw L.httpError(400, "Imagine invalidă.", "invalid");
      const mc = L.mediaContainer(); if (!mc) throw L.httpError(500, "Lipsește setarea STORAGE_CONNECTION_STRING.", "config");
      const blob = mc.getBlockBlobClient(id);
      if (!(await blob.exists())) throw L.httpError(404, "Imaginea nu există.", "not_found");
      const props = await blob.getProperties();
      if ((props.contentLength || 0) > 15 * 1024 * 1024) throw L.httpError(413, "Imaginea e prea mare.", "too_large");
      const buf = await blob.downloadToBuffer();
      return { status: 200, body: buf, headers: { "content-type": props.contentType || "image/jpeg", "cache-control": "public, max-age=86400" } };
    } catch (e) { return L.fail(e, context); }
  },
});
