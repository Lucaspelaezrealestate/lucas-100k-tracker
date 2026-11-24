import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PLAN_START = "2026-11-23"; // Day 1
const PLAN_DAYS = 100;

const store = () => getStore({ name: "tracker", consistency: "strong" });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function authorized(req: Request) {
  const pin = Netlify.env.get("PIN") || "";
  const token = Netlify.env.get("API_TOKEN") || "";
  const url = new URL(req.url);
  const hPin = req.headers.get("x-pin") || url.searchParams.get("pin") || "";
  const hTok = req.headers.get("x-token") || "";
  if (pin && hPin === pin) return "pin";
  if (token && hTok === token) return "token";
  return null;
}

const emptyDay = (date: string) => ({
  date,
  am: { affirmations: ["", "", ""], gratitude: ["", "", ""], top3: ["", "", ""] },
  metrics: {},        // manual overrides (any metric key)
  auto: {},           // filled by the daily task
  auto_meta: {},      // key -> { source, at }
  nonneg: {},         // id -> boolean
  nonneg_text: { extra: "" },
  recommended: {},    // id -> boolean
  recommended_text: { workout: "", other1: "", other2: "" },
  notes: "",          // Journal: notes & reflections
  plan_notes: "",     // Daily action plan: free lines at the bottom
  pm: { wins: "", growth: "", tomorrow: "" },
  photos: [] as string[],
  updatedAt: null as string | null,
});

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  const who = authorized(req);

  if (path === "/meta" && req.method === "GET") {
    return json({ planStart: PLAN_START, planDays: PLAN_DAYS });
  }
  if (!who) return json({ error: "unauthorized" }, 401);

  const s = store();

  if (path === "/days" && req.method === "GET") {
    const { blobs } = await s.list({ prefix: "days/" });
    const days = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
    return json({ days: days.filter(Boolean) });
  }

  const m = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (m && req.method === "GET") {
    const date = m[1];
    const rec = (await s.get(`days/${date}`, { type: "json" })) || emptyDay(date);
    return json(rec);
  }

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
      photos: prev.photos || [],
      updatedAt: new Date().toISOString(),
    };
    await s.setJSON(`days/${date}`, next);
    return json(next);
  }

  // POST /api/metrics  { date, auto: {...}, source }
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

  // POST /api/photo/:date  body: raw image bytes, header content-type image/jpeg|png
  const p = path.match(/^\/photo\/(\d{4}-\d{2}-\d{2})(?:\/(\d+))?$/);
  if (p && req.method === "POST") {
    const date = p[1];
    const ct = req.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return json({ error: "image only" }, 400);
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > 4_500_000) return json({ error: "too large" }, 413);
    const prev = (await s.get(`days/${date}`, { type: "json" })) || emptyDay(date);
    const id = String(Date.now());
    await s.set(`photos/${date}/${id}`, bytes, { metadata: { ct } });
    const photos = [...(prev.photos || []), id];
    const next = { ...prev, photos, updatedAt: new Date().toISOString() };
    await s.setJSON(`days/${date}`, next);
    return json({ id, photos });
  }
  if (p && p[2] && req.method === "GET") {
    const entry = await s.getWithMetadata(`photos/${p[1]}/${p[2]}`, { type: "arrayBuffer" });
    if (entry === null) return new Response("not found", { status: 404 });
    return new Response(entry.data, { headers: { "content-type": String(entry.metadata?.ct || "image/jpeg"), "cache-control": "private, max-age=86400" } });
  }
  if (p && p[2] && req.method === "DELETE") {
    if (who !== "pin") return json({ error: "pin required" }, 403);
    await s.delete(`photos/${p[1]}/${p[2]}`);
    const prev = (await s.get(`days/${p[1]}`, { type: "json" })) || emptyDay(p[1]);
    const next = { ...prev, photos: (prev.photos || []).filter((x: string) => x !== p[2]) };
    await s.setJSON(`days/${p[1]}`, next);
    return json(next);
  }

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
