# CFB Rankings

Static web page that shows every college football poll release for a season (AP, Coaches, CFP), each team's record and schedule, and an adjustable projection of the next poll. Data comes from the CollegeFootballData.com (CFBD) API, called directly from the browser with the visitor's own API key.

No build step and no server. Serve the folder as-is (GitHub Pages works).

## Files

| File | Responsibility |
|---|---|
| `index.html` | Markup only. Loads `styles.css` and the scripts below in order. |
| `styles.css` | All styling. Colors are CSS variables with a dark-mode override. |
| `js/core.js` | `$` selector, `localStorage` wrapper, shared page state. |
| `js/api.js` | CFBD calls, call-quota tracking, the per-season cache, refresh rules, score updates. |
| `js/views.js` | `ingest()` (normalizes a season), Grid and Weeks views, conference summary, team panel, `render()`. |
| `js/projection.js` | Weight definitions, the projection model, SP+ loading, the Projection view and weights panel. |
| `js/main.js` | Startup and event wiring. Loaded last, so every function it calls already exists. |

The scripts are classic (non-module) scripts sharing global scope. Only `main.js` runs code at load time; the others define functions and state.

## CFBD endpoints used

| Endpoint | When | Counts against quota |
|---|---|---|
| `GET /rankings?year&seasonType=regular\|postseason` | Load, when a new poll is expected | Yes (2 calls) |
| `GET /games?year&seasonType=regular\|postseason` | Load or Update scores, only when a started game lacks a final score | Yes (2 calls) |
| `GET /ratings/sp?year` | Load SP+ button | Yes (1 call) |
| `GET /info` | Page open, after loads, Check button | No |

Remaining calls are read from `/info` (`remainingCalls`) and from the `X-CallLimit-Remaining` response header when the browser can see it.

## Cache and refresh rules

One `localStorage` entry per season, key `cfbd-rankings:{year}`:

| Field | Meaning |
|---|---|
| `data` | Raw `/rankings` response (all weeks) |
| `games` | Slimmed `/games` rows, played and upcoming |
| `newest` / `newWeekAt` | Newest poll week held, and when this page first saw it |
| `fetchedAt` / `gamesAt` | Last rankings fetch / last games fetch |
| `sp` | SP+ ratings by team, with load time |

Rules:

- **Rankings** are fetched only after a scheduled release (AP/Coaches Sunday 18:00 UTC; CFP Wednesday 00:00 UTC in Nov–Dec) and only until the new week arrives. If CFBD hasn't posted it yet, Load retries at most every 30 minutes.
- **Games** are fetched only while a game involving a team that has been ranked this season has kicked off without a final score (games 7+ days past kickoff are treated as canceled). Final scores never change, so complete results are never re-fetched.
- **Past seasons** are never re-fetched.
- **Refresh from API** bypasses the rankings rule; the games rule still applies.

Other keys: `cfbd-key`, `cfbd-year`, `cfbd-conf`, `cfbd-quota`, `cfbd-weights`.

## Records and week numbering

CFBD labels the preseason poll week 1. A regular-season poll for week N reflects games with `week < N`; the preseason poll counts none; a postseason (final) poll counts all games. The Projection list shows records including the week being projected.

## Projection model

Each team in the latest regular-season poll starts at its share of #1's poll points (#1 = 1.000; polls without points use `(26 − rank) / 25`). Results since that poll adjust the score, every weight is a slider saved in `cfbd-weights`, and each adjustment is shown as a reason line under the team.

| Group | Criteria |
|---|---|
| Wins | Base bonus; bonus × opponent strength; per-point margin vs ranked opponents (capped); close-win penalty vs unranked; road-win bonus |
| Losses | Base penalty; relief × winner strength; loss to unranked; blowout; close loss; home loss |
| Opponent strength | Poll share for ranked teams; base strength for unranked shifted by record; optional SP+ blend (normalized: median team 0, best 1) |
| Season resume | Unbeaten bonus; RPI-style strength of schedule (2/3 opponents' win % excluding head-to-head + 1/3 opponents' opponents'); quality wins; bad losses |
| Unranked teams and head-to-head | Upset bonus; starting score as a share of #25; head-to-head winner placed ahead of loser within N spots |

New criteria default to 0 so they don't change the baseline. The Season resume group re-weighs games voters already saw; it is intended for approximating the CFP committee.

## API key

The repository contains no key. Each visitor gets a free key at collegefootballdata.com/key and enters it in the page; it is stored only in that browser.
