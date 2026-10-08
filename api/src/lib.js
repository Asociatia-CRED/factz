"use strict";
/* Logica comună: date (Azure Table Storage), fișiere (Blob Storage), identitate și permisiuni. */
const { TableClient, odata } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");

const COLS = ["categories", "articles", "users", "comments", "media", "subscribers", "polls", "views", "tags", "topics", "liveupdates", "reactions", "settings", "agent"];
const RANK = { jurnalist: 1, editor: 2, admin: 3 };
const REACTS = ["fire", "wow", "clap", "think", "angry"];
const DAY = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/* ---------- Azure Table Storage (în același Storage account cu pozele) ---------- */
// Fiecare document e o entitate: PartitionKey = colecția, RowKey = id-ul.
// Conținutul JSON e împărțit în bucăți (d0, d1, ...) pentru că o proprietate are maximum 64 KB.
const CHUNK = 30000, MAX_CHUNKS = 15;
let _table = null;
async function table() {
  if (_table) return _table;
  const cs = process.env.STORAGE_CONNECTION_STRING;
  if (!cs) throw httpError(500, "Lipsește setarea STORAGE_CONNECTION_STRING în Azure (Static Web App > Environment variables).", "config");
  const t = TableClient.fromConnectionString(cs, process.env.STORAGE_TABLE || "factzdata", { allowInsecureConnection: /UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(cs) });
  try { await t.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
  _table = t;
  return _table;
}
function encode(col, id, data) {
  const clean = { ...data }; delete clean.id;
  const s = JSON.stringify(clean);
  const n = Math.max(1, Math.ceil(s.length / CHUNK));
  if (n > MAX_CHUNKS) throw httpError(413, "Documentul e prea mare (peste ~450.000 de caractere). Împarte articolul în mai multe părți.", "too_large");
  const ent = { partitionKey: col, rowKey: id, n };
  for (let i = 0; i < n; i++) ent["d" + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
  return { ent, clean };
}
function decode(ent) {
  let s = ""; for (let i = 0; i < (ent.n || 0); i++) s += ent["d" + i] || "";
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}
async function listEntities(filter) {
  const t = await table(); const out = [];
  for await (const e of t.listEntities(filter ? { queryOptions: { filter } } : undefined)) out.push(e);
  return out;
}
async function readAll() {
  const out = Object.fromEntries(COLS.map(k => [k, {}]));
  for (const e of await listEntities()) if (out[e.partitionKey]) out[e.partitionKey][e.rowKey] = decode(e);
  return out;
}
async function readCol(col) {
  const out = {};
  for (const e of await listEntities(odata`PartitionKey eq ${col}`)) out[e.rowKey] = decode(e);
  return out;
}
async function getRaw(col, id) {
  const t = await table();
  try { return await t.getEntity(col, id); } catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function getDoc(col, id) { const e = await getRaw(col, id); return e ? decode(e) : null; }
async function putDoc(col, id, data) {
  const t = await table(); const { ent, clean } = encode(col, id, data);
  await t.upsertEntity(ent, "Replace");
  return clean;
}
async function delDoc(col, id) {
  const t = await table();
  try { await t.deleteEntity(col, id); } catch (e) { if (e.statusCode !== 404) throw e; }
}
/* citire-modificare-scriere cu verificare de versiune (pentru contoare: citiri, reacții, voturi) */
async function mutate(col, id, fn) {
  const t = await table();
  for (let i = 0; i < 25; i++) {
    if (i) await new Promise(r => setTimeout(r, Math.min(400, 15 * 2 ** Math.min(i, 5)) * (0.5 + Math.random())));
    const raw = await getRaw(col, id);
    const next = fn(raw ? decode(raw) : null);
    const { ent } = encode(col, id, next);
    try {
      if (raw) await t.updateEntity(ent, "Replace", { etag: raw.etag });
      else await t.createEntity(ent);
      return next;
    } catch (e) { if (e.statusCode === 412 || e.statusCode === 409) continue; throw e; }
  }
  throw httpError(503, "Prea multe modificări simultane. Încearcă din nou.", "unavailable");
}

/* ---------- Blob Storage ---------- */
function mediaContainer() {
  const cs = process.env.STORAGE_CONNECTION_STRING;
  if (!cs) return null;
  return BlobServiceClient.fromConnectionString(cs).getContainerClient(process.env.STORAGE_CONTAINER || "media");
}

/* ---------- identitate ---------- */
function principal(req) {
  const h = req.headers.get("x-ms-client-principal");
  if (!h) return null;
  try { const p = JSON.parse(Buffer.from(h, "base64").toString("utf8")); return p && p.userDetails ? p : null; } catch { return null; }
}
const authKey = p => `${p.identityProvider || "x"}:${p.userId || ""}`;
const isMasked = s => /\*/.test(String(s || ""));
// Găsește membrul redacției pentru utilizatorul logat. Azure trimite uneori adresa mascată („aso*****”),
// așa că fiecare cont e legat permanent de codul unic Azure (userId) la prima potrivire.
function findMember(p, users) {
  if (!p) return null;
  const key = authKey(p), mail = String(p.userDetails || "").toLowerCase();
  const act = Object.entries(users).filter(([, u]) => u && u.active !== false);
  let hit = act.find(([, u]) => (u.authIds || []).includes(key));
  if (!hit && p.userId) hit = act.find(([, u]) => String(u.email || "").trim() === p.userId);
  if (!hit && mail && !isMasked(mail)) hit = act.find(([, u]) => String(u.email || "").toLowerCase().trim() === mail);
  return hit ? { ...hit[1], id: hit[0] } : null;
}
async function resolveMember(p, users) {
  if (!p) return null;
  let m = findMember(p, users);
  const key = authKey(p);
  const allowed = String(process.env.ADMIN_USER_IDS || "").split(/[\s,;]+/).filter(Boolean);
  const isOwner = !!p.userId && allowed.includes(p.userId);
  // codurile din ADMIN_USER_IDS sunt mereu administratori
  if (m && isOwner && m.role !== "admin") {
    const doc = { ...m, role: "admin" }; const id = doc.id; delete doc.id;
    await putDoc("users", id, doc); users[id] = doc; m = { ...doc, id };
  }
  // recuperare: codurile din setarea ADMIN_USER_IDS devin administrator (leagă primul admin încă nelegat)
  if (!m && p.userId) {
    if (isOwner) {
      const admins = Object.entries(users).filter(([, u]) => u && u.active !== false && u.role === "admin");
      const free = admins.find(([, u]) => !(u.authIds || []).length) || admins[0];
      if (free) m = { ...free[1], id: free[0] };
      else { const id = "u" + Date.now().toString(36); m = { name: "Administrator", email: "", role: "admin", active: true, bio: "", createdAt: Date.now(), id }; }
    }
  }
  if (m && p.userId && !(m.authIds || []).includes(key)) {
    const doc = { ...m, authIds: [...(m.authIds || []), key].slice(-5) };
    if ((!doc.email || isMasked(doc.email) || doc.email === p.userId) && !isMasked(p.userDetails)) doc.email = p.userDetails;
    const id = doc.id; delete doc.id;
    await putDoc("users", id, doc);
    users[id] = doc;
    m = { ...doc, id };
  }
  return m;
}
const rank = u => (u && RANK[u.role]) || 0;

/* ---------- utilitare ---------- */
function httpError(status, message, code) { const e = new Error(message); e.status = status; e.code = code; return e; }
function json(status, body) { return { status, jsonBody: body, headers: { "cache-control": "no-store" } }; }
function fail(e, context) {
  if (e && e.status) return json(e.status, { error: e.message, code: e.code });
  if (context) context.error(e);
  return json(500, { error: "Eroare de server. Încearcă din nou peste puțin timp.", code: "unavailable" });
}
const isLive = a => a && (a.status === "published" || (a.status === "scheduled" && a.publishAt && a.publishAt <= Date.now()));
function dayKey(ts) { const d = new Date(ts + 3 * 3600000); return d.toISOString().slice(0, 10); } // ora României (aproximativ)
function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

module.exports = { COLS, RANK, REACTS, DAY, ID_RE, authKey, isMasked, resolveMember, readAll, readCol, getDoc, putDoc, delDoc, mutate, mediaContainer, principal, findMember, rank, httpError, json, fail, isLive, dayKey, deepMerge };
