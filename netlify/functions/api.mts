import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PLAN_START = "2026-11-23"; // Day 1
const PLAN_DAYS = 100;

const store = () => getStore({ name: "tracker", consistency: "strong" });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function authorized(req: Request, allowToken = true) {
  const pin = Netlify.env.get("PIN") || "";
  const token = Netlify.env.get("API_TOKEN") || "";
  const hPin = req.headers.get("x-pin") || "";
  const hTok = req.headers.get("x-token") || "";
  if (pin && hPin === pin) return "pin";
  if (allowToken && token && hTok === token) return "token";
  return null;
}

const emptyDay = (date: string) => ({
  date,
  am: { affirmations: ["", "", ""], gratitude: ["", "", ""], top3: ["", "", ""] },
  metrics: {
    calls: null, convos: null, appts_set: null, appts_conducted: null,
    listings_taken: null, buyer_agreements: null, zma_texts: null,
    emails_sent: null, posts: null, prospecting_min: null, cma_videos: null,
    gci_pending: null, gci_closed: null,
  },
  auto: {},            // same keys as metrics, filled by the daily task
  auto_meta: {},       // { source, at }
  nonneg: {},          // id -> boolean
  recommended: {},     // id -> boolean
  pm: { wins: "", growth: "", tomorrow: "" },
  updatedAt: null as string | null,
});

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  const who = authorized(req);

  // Public: plan meta (no data)
  if (path === "/meta" && req.method === "GET") {
    return json({ planStart: PLAN_START, planDays: PLAN_DAYS });
  }
  if (!who) return json({ error: "unauthorized" }, 401);

  const s = store();

  // GET /api/days  -> all day records (compact)
  if (path === "/days" && req.method === "GET") {
    const { blobs } = await s.list({ prefix: "days/" });
    const days = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
    return json({ days: days.filter(Boolean) });
  }

  // GET /api/day/:date
  const m = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (m && req.method === "GET") {
    const date = m[1];
    const rec = (await s.get(`days/${date}`, { type: "json" })) || emptyDay(date);
    return json(rec);
  }

  // PUT /api/day/:date  (UI, full record merge)
  if (m && req.method === "PUT") {
    if (who !== "pin") return json({ error: "pin required" }, 403);
    const date = m[1];
    const body = await req.json();
    const prev = (await s.get(`days/${date}`, { type: "json" })) || emptyDay(date);
    const next = {
      ...prev,
      ...body,
      date,
      auto: prev.auto,
      auto_meta: prev.auto_meta,
      updatedAt: new Date().toISOString(),
    };
    await s.setJSON(`days/${date}`, next);
    return json(next);
  }

  // POST /api/metrics  { date, auto: {calls:..}, source: "mojo|calendar|quo" }
  if (path === "/metrics" && req.method === "POST") {
    const body = await req.json();
    const date = body.date;
    if (!isValidDate(date)) return json({ error: "bad date" }, 400);
    const prev = (await s.get(`days/${date}`, { type: "json" })) || emptyDay(date);
    const at = new Date().toISOString();
    const auto = { ...(prev.auto || {}) };
    const meta = { ...(prev.auto_meta || {}) };
    for (const [k, v] of Object.entries(body.auto || {})) {
      if (v === null || v === undefined) continue;
      auto[k] = v;
      meta[k] = { source: body.source || who, at };
    }
    const next = { ...prev, auto, auto_meta: meta, updatedAt: at };
    await s.setJSON(`days/${date}`, next);
    return json(next);
  }

  // GET/PUT /api/settings (targets, GCI goal, etc.)
  if (path === "/settings") {
    if (req.method === "GET") return json((await s.get("settings", { type: "json" })) || {});
    if (req.method === "PUT") {
      if (who !== "pin") return json({ error: "pin required" }, 403);
      const body = await req.json();
      await s.setJSON("settings", body);
      return json(body);
    }
  }

  return json({ error: "not found" }, 404);
};

export const config: Config = { path: "/api/*" };
