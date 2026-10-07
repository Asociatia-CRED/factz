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
      const me = L.findMember(p, all.users);
      const r = L.rank(me);
      const data = { ...all };
      // articole: publicul vede doar ce e publicat; jurnaliștii văd și ciornele proprii; editorii văd tot
      if (r < 2) data.articles = Object.fromEntries(Object.entries(all.articles).filter(([, a]) => L.isLive(a) || (me && a.authorId === me.id)));
      // comentarii: publicul vede doar ce e aprobat
      if (r < 2) data.comments = Object.fromEntries(Object.entries(all.comments).filter(([, c]) => c.status === "approved"));
      // date private
      if (r < 2) data.subscribers = {};
      if (r < 1) data.media = {};
      if (r < 3) data.users = Object.fromEntries(Object.entries(all.users).map(([id, u]) => [id, { ...u, email: me && me.id === id ? u.email : undefined }]));
      const mc = L.mediaContainer();
      return L.json(200, {
        data,
        mediaBase: mc ? mc.url : "",
        bootstrapNeeded: Object.keys(all.users).length === 0,
        me: { principal: p ? { userDetails: p.userDetails, identityProvider: p.identityProvider } : null, user: me },
      });
    } catch (e) { return L.fail(e, context); }
  },
});
