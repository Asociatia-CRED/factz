"use strict";
/* GET /api/data — tot conținutul pe care îl poate vedea vizitatorul curent. */
const { app } = require("@azure/functions");
const L = require("../lib");

app.http("data", {
  methods: ["GET"], authLevel: "anonymous", route: "data",
  handler: async (req, context) => {
    try {
      const all = await L.readAll();
      const p = L.principal(req);
      const me = await L.resolveMember(p, all.users);
      const r = L.rank(me);
      const data = { ...all };
      // articole: publicul vede doar ce e publicat; jurnaliștii văd și ciornele proprii; editorii văd tot
      if (r < 2) data.articles = Object.fromEntries(Object.entries(all.articles).filter(([, a]) => L.isLive(a) || (me && a.authorId === me.id)));
      // comentarii: publicul vede doar ce e aprobat
      if (r < 2) data.comments = Object.fromEntries(Object.entries(all.comments).filter(([, c]) => c.status === "approved"));
      // date private
      if (r < 2) { data.subscribers = {}; data.agent = {}; }
      if (r < 1) data.media = {};
      // codurile secrete din linkurile de confirmare/dezabonare nu pleacă niciodată spre browser
      data.subscribers = Object.fromEntries(Object.entries(data.subscribers).map(([id, x]) => [id, { ...x, token: undefined }]));
      data.users = Object.fromEntries(Object.entries(all.users).map(([id, u]) => [id, r >= 3 ? { ...u, authIds: undefined, linked: !!(u.authIds || []).length } : { ...u, email: me && me.id === id ? u.email : undefined, authIds: undefined }]));
      const mc = L.mediaContainer();
      return L.json(200, {
        data,
        mediaBase: mc ? mc.url : "",
        bootstrapNeeded: Object.keys(all.users).length === 0,
        pushKey: String(process.env.VAPID_PUBLIC_KEY || "").trim(),
        me: { principal: p ? { userDetails: p.userDetails, identityProvider: p.identityProvider, userId: p.userId } : null, user: me ? { ...me, authIds: undefined } : null },
      });
    } catch (e) { return L.fail(e, context); }
  },
});
