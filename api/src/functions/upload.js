"use strict";
/* POST /api/upload — încarcă o imagine, un video sau un PDF în Blob Storage (doar redacția). */
const { app } = require("@azure/functions");
const crypto = require("crypto");
const L = require("../lib");

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm", "application/pdf": "pdf" };
const MAX = 20 * 1024 * 1024;

app.http("upload", {
  methods: ["POST"], authLevel: "anonymous", route: "upload",
  handler: async (req, context) => {
    try {
      const me = await L.resolveMember(L.principal(req), await L.readCol("users"));
      if (L.rank(me) < 1) throw L.httpError(403, "Doar redacția poate încărca fișiere.", "forbidden");
      const type = String(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = TYPES[type];
      if (!ext) throw L.httpError(400, "Tipul fișierului nu e acceptat. Folosește JPG, PNG, WEBP, GIF, MP4, WEBM sau PDF.", "unsupported_type");
      const buf = Buffer.from(await req.arrayBuffer());
      if (!buf.length) throw L.httpError(400, "Fișierul e gol.", "invalid");
      if (buf.length > MAX) throw L.httpError(413, "Fișierul depășește limita de 20 MB.", "too_large");
      const mc = L.mediaContainer();
      if (!mc) throw L.httpError(500, "Lipsește setarea STORAGE_CONNECTION_STRING în Azure.", "config");
      await mc.createIfNotExists({ access: "blob" });
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
      await mc.getBlockBlobClient(name).uploadData(buf, { blobHTTPHeaders: { blobContentType: type, blobCacheControl: "public, max-age=31536000, immutable" } });
      return L.json(200, { id: name, contentType: type, size: buf.length });
    } catch (e) { return L.fail(e, context); }
  },
});
