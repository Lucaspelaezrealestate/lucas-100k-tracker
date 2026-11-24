# 100K in 100 Days — Tracker (Lucas Pelaez)

Daily journal + tracker that mirrors the Tom Ferry "$100K in 100 Days" planner (Journal page + Daily Action Plan page), plus Lucas's own pipelines (YouTube house tours, Open Houses). Numbers are filled automatically every night by a Claude scheduled task; Lucas fills the journal, checklists and reflections.

- Live: https://lucas-100k-tracker.netlify.app (Netlify site id `202f82d9-929b-42d5-9438-e18eb507bfb9`)
- Plan: Day 1 = 2026-11-23 · Day 100 = 2027-03-02
- Source planner & guide PDFs: Google Drive folder `1AD8fb1Vhe7b7TcmDR_Kpa0MpGxobOJwp`

## Stack
- `public/index.html` — the whole app (vanilla JS, no build). Tabs: Today (Journal · Daily Action Plan · Pipelines), Scorecard, History.
- `netlify/functions/api.mts` — Netlify Function at `/api/*`, storage in Netlify Blobs (store `tracker`, strong consistency).
- `netlify.toml` — publish `public`, functions `netlify/functions`.
- Deploys automatically from `main` (GitHub → Netlify continuous deployment).

## Environment variables (Netlify → Site → Environment variables)
- `PIN` — 4-digit PIN for the UI (sent as header `x-pin`).
- `API_TOKEN` — secret for the nightly task (sent as header `x-token`).

## Data model (Blobs key `days/YYYY-MM-DD`)
```
date, am{affirmations[3], gratitude[3], top3[3]},
metrics{}        manual overrides per metric key
auto{}           values filled by the nightly task
auto_meta{k:{source, at}},
nonneg{id:bool}, nonneg_text{extra},
recommended{id:bool}, recommended_text{workout, other1, other2},
notes, plan_notes, pm{wins, growth, tomorrow}, photos[id], updatedAt
```
Effective value of a metric = `metrics[k]` if not null, else `auto[k]`, else 0.

Metric keys: `calls, convos, appts_set, listings_taken, buyer_agreements, zma_texts, appts_conducted, emails_sent, posts, cma_videos, prospecting_min, gci_pending, gci_closed, yt_recorded, yt_scheduled, yt_approach, yt_followups, yt_replies, oh_approach, oh_active, oh_followups, oh_replies`

Photos: `photos/YYYY-MM-DD/<id>` (JPEG, resized client-side to 1600px).

## API
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/meta` | none | planStart, planDays |
| GET | `/api/days` | pin/token | all day records |
| GET | `/api/day/:date` | pin/token | one day (empty template if none) |
| PUT | `/api/day/:date` | pin | save UI fields (never overwrites `auto`) |
| POST | `/api/metrics` | pin/token | `{date, source, auto:{k:v}}` → merged into `auto` |
| POST | `/api/photo/:date` | pin/token | raw image bytes, `content-type: image/*` |
| GET/DELETE | `/api/photo/:date/:id` | pin (`?pin=` allowed on GET) | |
| GET/PUT | `/api/settings` | pin | free JSON |

## Scorecard rules
Daily targets: weekdays 50 calls / 10 convos; weekends 10 / 2; 5 ZMA texts; 2 posts; non-negotiables 100 % ("Send weekly email" counts only on Thursdays). Score = average of those five percentages (capped at 100). Views: today, week (Mon–Sun), month, 100-day plan. Funnel: convos → appts_set, appts_conducted → listings + buyer agreements. GCI closed vs $100K.

"Appointments" in the Journal = appointments **set/booked** that day (per the guide's funnel: conversations → appointments → listings). Appointments **held** are tracked separately under Pipelines → Other activity.

## Nightly scheduled task (Claude, 8:47 PM America/New_York)
Lives in Lucas's Claude account (Scheduled tasks → "100K tracker · daily metrics fill"). If it is ever lost, recreate it with the prompt below. It needs the Mojo Dialer, Google Calendar and Quo connectors, and network access to `lucas-100k-tracker.netlify.app` (claude.ai → Settings → Capabilities → allowed domains).

```
You are filling Lucas Pelaez's "100K in 100 Days" tracker app with TODAY's activity numbers. RULE #1: every number must be something that HAPPENED TODAY or was BOOKED TODAY (America/New_York). Never count future events just because they are upcoming, and never count messages from other days. Do not ask questions; if a source fails, skip it and report. Today 00:00 local = 05:00Z (EST) / 04:00Z (EDT).

1) MOJO: get_call_summary(date_from=today, date_to=today, group_by="day"). total.calls → calls; total.contacts → convos; round(total.talk_time_seconds/60) → prospecting_min; total.appointments → mojo_appts (used in step 2).

2) GOOGLE CALENDAR (primary). Use the event's `created` timestamp to decide what was booked today.
   - appts_set = mojo_appts + events (any future date, fetch today through +30 days) whose `created` is today AND whose title contains Showing, Listing appt, Listing appointment, Buyer consult, Cita or CONFIRMED (case-insensitive). Ignore recurring-template titles (100K ·, GRABACIÓN, Traslado, Almuerzo, Sleep, Group Zoom, Coaching, OPR TEAM MEETING).
   - appts_conducted = events whose START is today with those same appointment keywords.
   - yt_recorded = events whose START is today and whose title is a street address or contains "tour" (a confirmed recording), NOT the template "GRABACIÓN n · YouTube" blocks.
   - yt_scheduled = recording/tour events (title = address or contains tour) whose `created` is today, regardless of their start date.

3) QUO (fetch-messages, whole-inbox mode, createdAfter = today 00:00 local in UTC). Run inboxes one at a time, never in parallel. Count only messages timestamped today.
   a) Followup Boss +17867237560: zma_texts = number of CONVERSATIONS with an outgoing message today containing Zillow, Zestimate, home value, estimate, worth or value (case-insensitive). One contact = 1, even if text + image were sent separately.
   b) YouTube +17864310767: yt_approach = conversations whose first message today is outgoing and is a new approach ("Saw your new listing… Would you be open"); yt_followups = outgoing messages today that are not a first approach (e.g. "You passed on…", "thank you", "I also saw…"); yt_replies = incoming messages today.
   c) Open Houses +17869809319: oh_approach = conversations started today with the open-house ask ("Would you let me host an open house"); oh_followups = other outgoing messages today in existing conversations; oh_replies = incoming messages today; oh_active = conversations with any message in the last 14 days where the agent has NOT said no/sold/not possible (read the replies).

4) POST to the app (only keys you obtained):
   curl -s -X POST https://lucas-100k-tracker.netlify.app/api/metrics -H "content-type: application/json" -H "x-token: <API_TOKEN>" -d '{"date":"<today>","source":"auto","auto":{"calls":N,"convos":N,"appts_set":N,"prospecting_min":N,"appts_conducted":N,"zma_texts":N,"yt_recorded":N,"yt_scheduled":N,"yt_approach":N,"yt_followups":N,"yt_replies":N,"oh_approach":N,"oh_active":N,"oh_followups":N,"oh_replies":N}}'
   Confirm the response echoes the auto values.

5) If the POST fails because the domain is unreachable from this environment, retry at most twice, then report the numbers in your final message so Lucas can type them in, and say the app was not updated. Day N = days since 2026-11-23 inclusive (Nov 23 = Day 1).

Final message: one line, e.g. "Day 2 · 50 dials · 8 convos · 1 appt set · 2 appts held · 6 ZMA · YT: 2 recorded, 4 approach, 3 follow-ups · OH: 5 approach, 7 follow-ups · app updated ✓". Nothing else.
```

## Quo lines used
- Followup Boss `+1 786-723-7560` — ZMA texts to Lucas's database (FUB-synced contacts).
- YouTube `+1 786-431-0767` — listing-agent permission requests for house tours (shared with Alex Sanchoyerto).
- Open Houses `+1 786-980-9319` — open-house hosting requests to listing agents.
- Outreach Listings `+1 786-733-6873` — Mojo Dialer caller ID (circle prospecting).

## Journal photo
"Journal photo" input on the Journal page uploads a photo of the handwritten planner page to the day (`POST /api/photo/:date`). Claude can also transcribe a photo sent in chat into the day's fields via `PUT /api/day/:date` and attach it via the same endpoint.
