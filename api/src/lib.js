"use strict";
/* Logica comună: baza de date (Cosmos DB), fișiere (Blob Storage), identitate și permisiuni. */
const { CosmosClient } = require("@azure/cosmos");
const { BlobServiceClient } = require("@azure/storage-blob");

const COLS = ["categories", "articles", "users", "comments", "media", "subscribers", "polls", "views", "tags", "topics", "liveupdates", "reactions", "settings"];
const RANK = { jurnalist: 1, editor: 2, admin: 3 };
const REACTS = ["fire", "wow", "clap", "think", "angry"];
const DAY = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/* ---------- Cosmos DB ---------- */
let _container = null;
async function container() {
  if (_container) return _container;
  const cs = process.env.COSMOS_CONNECTION_STRING;
  if (!cs) throw httpError(500, "Lipsește setarea COSMOS_CONNECTION_STRING în Azure (Static Web App > Environment variables).", "config");
  const client = new CosmosClient(cs);
  const { database } = await client.databases.createIfNotExists({ id: process.env.COSMOS_DB || "spillthefacts" });
  const { container } = await database.containers.createIfNotExists({ id: process.env.COSMOS_CONTAINER || "docs", partitionKey: { paths: ["/col"] } });
  _container = container;
  return _container;
}
const itemId = (col, id) => `${col}|${id}`;

async function readAll() {
  const c = await container();
  const { resources } = await c.items.query("SELECT c.col, c.docId, c.data FROM c").fetchAll();
  const out = Object.fromEntries(COLS.map(k => [k, {}]));
  for (const r of resources) if (out[r.col]) out[r.col][r.docId] = r.data;
  return out;
}
async function readCol(col) {
  const c = await container();
  const { resources } = await c.items.query({ query: "SELECT c.docId, c.data FROM c WHERE c.col = @col", parameters: [{ name: "@col", value: col }] }, { partitionKey: col }).fetchAll();
  return Object.fromEntries(resources.map(r => [r.docId, r.data]));
}
async function getDoc(col, id) {
  const c = await container();
  try { const { resource } = await c.item(itemId(col, id), col).read(); return resource ? resource.data : null; }
  catch (e) { if (e.code === 404) return null; throw e; }
}
async function putDoc(col, id, data) {
  const c = await container();
  const clean = { ...data }; delete clean.id;
  await c.items.upsert({ id: itemId(col, id), col, docId: id, data: clean });
  return clean;
}
async function delDoc(col, id) {
  const c = await container();
  try { await c.item(itemId(col, id), col).delete(); } catch (e) { if (e.code !== 404) throw e; }
}
/* citire-modificare-scriere cu verificare de versiune (pentru contoare: citiri, reacții, voturi) */
async function mutate(col, id, fn) {
  const c = await container();
  for (let i = 0; i < 5; i++) {
    let cur = null, etag = null;
    try { const { resource } = await c.item(itemId(col, id), col).read(); if (resource) { cur = resource.data; etag = resource._etag; } }
    catch (e) { if (e.code !== 404) throw e; }
    const next = fn(cur ? JSON.parse(JSON.stringify(cur)) : null);
    const item = { id: itemId(col, id), col, docId: id, data: next };
    try {
      if (etag) await c.item(itemId(col, id), col).replace(item, { accessCondition: { type: "IfMatch", condition: etag } });
      else await c.items.create(item);
      return next;
    } catch (e) { if (e.code === 412 || e.code === 409) continue; throw e; }
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
function findMember(p, users) {
  if (!p) return null;
  const key = String(p.userDetails).toLowerCase();
  for (const [id, u] of Object.entries(users)) {
    if (u && u.active !== false && String(u.email || "").toLowerCase() === key) return { ...u, id };
  }
  return null;
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

module.exports = { COLS, RANK, REACTS, DAY, ID_RE, container, readAll, readCol, getDoc, putDoc, delDoc, mutate, mediaContainer, principal, findMember, rank, httpError, json, fail, isLive, dayKey, deepMerge };
