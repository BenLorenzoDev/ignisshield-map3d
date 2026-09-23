# IgnisShield Map 3D

A 3D map of Sitio Polo, Barangay Baliwagan, Balamban, Cebu, for tracing and editing building footprints.

## Open it

Double-click `Start-Map3D.cmd`, then use **http://127.0.0.1:8780**. It needs Python (for the local file server) and an internet connection (map tiles). The first run installs and vendors MapLibre with npm if `public/vendor` is missing.

## What you see

- **Base map:** OpenFreeMap "liberty" style (OpenStreetMap data), with its grey 3D OSM buildings. No API key needed. **Satellite** switches to Esri World Imagery and hides the OSM buildings.
- **Terrain:** AWS Terrarium elevation tiles with hillshade, exaggerated 1.3×.
- **Inventory (orange):** the 88 buildings and the student boundary copied from `IgnisShield-Web/public/data/source.geojson`. The inventory records no heights, so these are drawn at a fixed 6 m for display only.
- **AI outlines (cyan):** 1,559 outlines from Microsoft Global ML Building Footprints (release 2026-02-03, ODbL), in `public/data/ai-buildings.geojson`. They cover roughly 350 m around the inventory's extent. They are added to your saved buildings on first load.
- **Your buildings (blue):** traced buildings and edited AI outlines. All saved buildings rise in 3D at 3 m per storey (1 storey by default).

The **AI outlines** and **Inventory** checkboxes show or hide those layers.

Controls: drag to pan, right-drag (or Ctrl+drag) to rotate and tilt, scroll to zoom.

## Satellite photo date

In Satellite mode a menu picks the photo date from Esri World Imagery Wayback. All five photos are about 0.6 m/pixel (zoom 18); zooming further only enlarges them.
- **2023-06-29 (default):** cloud-free over the whole study area.
- **2026-05-28:** newer and a little sharper, but clouds cover the settlement near the pier.

Switch dates where one photo is cloudy or out of date, for example for recently built houses. Outlines can shift by about a metre between photos, so keep to one date for a block where possible. Each traced building records the photo date in its source.

## Trace a building

1. Click **Satellite**, then **Trace building**. The map flattens to 2D and zooms in.
2. Click each roof corner. To finish, click the first corner again or press **Enter**. **Backspace** undoes a corner and **Esc** cancels.

## Edit a building

Click any AI outline or traced building to select it (it turns yellow). The panel sets **storeys** or **deletes** it. In **2D**:

- drag a yellow corner to move it;
- drag a white midpoint dot to add a corner;
- click a corner (it turns red), then press **Delete** or click **Remove corner**;
- drag inside the shape to move the whole building onto the right roof;
- **Revert shape** undoes all shape changes since you selected it.

An edited AI outline turns blue and is labelled "AI outline (edited)".

## Saving

Everything is saved in this browser's storage (`localStorage`, key `ignisshield-map3d.traced`). It survives view switches, reloads and restarts. It does not survive clearing site data or moving to another browser or PC. **Export** downloads all buildings as GeoJSON for backup or for use in QGIS / IgnisShield-Web.

## Accuracy limits

- Native imagery here stops at about 0.6 m/pixel (zoom 18); closer zooms are enlarged from it.
- Roofs include the eaves, so outlines come out slightly larger than the walls.
- Houses under tree canopy cannot be seen from imagery.
- AI outlines are rectangles and are often shifted 1–2 m, which is why the move and corner tools exist.

## Fire simulation (research paper inputs and outputs)

The app follows the paper's Chapter 2 notation: nine inputs X1–X9 and eight outputs Y1–Y8, in the paper's units. Two unit typos in the paper's table are corrected here: alley/road width is metres (the paper says °) and wind direction is degrees (the paper says metres).

**Inputs.** Click a building: one form shows all nine inputs in the paper's order (X1–X9), then **Start fire here**. Five belong to the building:
- **Db** building density (structures/m²): blank means measured from the map, as structures within 30 m per m²;
- **Mb** fuel load density (MJ/m²);
- **O₂** oxygen availability (ratio φO₂, 1 = normal air, 20.9 %);
- **Nh** number of houses in the structure;
- **Wr** alley/road width (m).

**Scenario & runs** holds the weather inputs (**Hr** %, **Ta** °C, **Uw** m/s, **Θw** ° wind FROM) and the run settings:
- replay number (the random seed: the same inputs and number always give the same fire);
- number of runs, each with the next replay number;
- maximum minutes;
- whether to use only buildings inside the study boundary.

**Live weather.** In the Custom scenario, **Use live weather** loads Open-Meteo (free, no API key, CC BY 4.0) for Sitio Polo. It fills Hr, Ta, Uw and Θw from current conditions, or from any hour of the next ~2 days that you choose. Each run records its weather source in the log. The wind is the forecast model's 10 m value for its grid cell, so street-level wind in narrow alleys is usually lower. For reference, the 2025 hourly wind at this point had a median of 2.95 m/s, a 75th percentile of 4.42 and a 90th of 6.49 (Open-Meteo archive).

**Trials A–D** (paper Table 1) are one-click presets whose nine values replace every building's inputs. The paper describes the trials only in words, so their numbers are **drafts**. Edit them in the panel or use *Reset this trial to the draft values*.

| Trial conditions | Db | Mb | O₂ | Hr | Ta | Nh | Wr | Uw | Θw |
|---|---|---|---|---|---|---|---|---|---|
| A (baseline) | measured | 600 | 1.0 | 85 | 27 | 1 | 4 | 1 | 45 |
| B | measured | 900 | 1.0 | 70 | 31 | 2 | 3 | 4 | 45 |
| C | 0.004 | 1200 | 1.0 | 55 | 33 | 2 | 1.5 | 7 | 225 |
| D (worst case) | 0.006 | 1500 | 1.2 | 35 | 36 | 3 | 1 | 10 | 225 |

The presets are **input conditions only**. The severity level (Low / Moderate / High / Catastrophic) is never chosen: it is an **output** of each run, from Sf (Y1), shown as the result headline and logged with every run. The paper expects conditions A–D to produce roughly increasing severity; the runs test whether they do.

For reference, measured Db on the current map has a median of 0.0021 structures/m², a 90th percentile of 0.0039 and a 99th of 0.0057.

**Draft conversions to the model** are all in `public/paper.js`, and the panel shows them:
- **Db** → coverage fraction: Db × average footprint area within 30 m, capped at 1.
- **Mb** → material class: below 700 MJ/m² = 1 concrete, below 1100 = 2 mixed, otherwise 3 wood/nipa.
- **O₂** → ventilation multiplier: used directly.
- **Uw** → km/h: × 3.6.
- **Nh, Wr, Hr, Ta, Θw:** used directly.

Replace these rules when the students supply their formulas.

**Outputs** (bottom panel and run log):

| Output | Unit | Definition |
|---|---|---|
| Sf (Y1) | 0–1 | share of the run's building floor area that ignited. Below 0.1 Low, below 0.3 Moderate, below 0.6 High, otherwise Catastrophic. |
| If (Y2) | kW/m | peak fire line intensity (model proxy) |
| R (Y3) | m/min | spread rate |
| Q (Y4) | MW and kW | peak heat release rate (model proxy) |
| Ab (Y5) | m² | total burned area |
| φs (Y6) | ° | spread direction |
| τb (Y7) | min | average time an ignited building burns (draft definition) |
| Tsim (Y8) | min, s and h | modelled time from ignition until the fire is out or the run limit is reached |

**Run log.** Every run is logged with its X1–X9 and Y1–Y8. Batches show the mean ± SD of Sf and Ab. **Export CSV** downloads the whole log for analysis. Replay works for runs made in the current session. The log is kept in this browser (`ignisshield-map3d.runs`, last 1,000 runs).

Every saved building takes part in a run (AI outlines and traced), or only those inside the study boundary if that box is ticked. The orange inventory is display-only.

## Routes

**Routes** uses the inventory's 367 road segments. They are OpenStreetMap-based: widths are assumed by road class, and the interior 1 m alleys are mostly not mapped yet.

- **Who is moving:** Walking (4.5 km/h, roads at least 0.8 m wide) or Fire engine (15 km/h, at least 2.5 m, one-way rules apply). You can change the speed and width.
- **Reach a destination:** compares the shortest-distance route (baseline) with the fastest modelled route.
- **Visit checkpoints:** compares the order you clicked (baseline) with the best visiting order (the Hamiltonian path of the paper). It's exact for up to 12 checkpoints and uses a heuristic for 13–20. It can also return to the start.
- **Avoid the fire at the minute on screen:** drops road segments within the clearance distance of buildings that are burning or burned at the minute shown in playback.
- **Travel time** per segment is length ÷ speed × (1 + 0.6 / width) × (1 + 0.5 × nearby building coverage). It is static: no crowding or live traffic.

## Field survey: GPS tracks and paths

Public maps miss most of Polo's interior alleys, so students walk them with Strava and the class draws them in.

1. **Export the walk.** The student who recorded it goes to strava.com, opens the **activity** (address `/activities/…`, not `/routes/…`) and chooses **⋯ → Export Original** (or Export GPX). Route files are refused: Strava simplifies them to about 100 points.
2. **Import.** An editor opens **Routes → Import GPX walks**. `public/field.js` does the cleanup:
   - keeps only walking and drops riding (over 9 km/h averaged over 15 s);
   - splits the track where GPS was lost (over 20 s or a jump over 25 m);
   - thins standing-still scribbles (a point at least every 3 m);
   - **removes all timestamps and names**, keeping only the walk date.

   Tracks show in pink, and the **GPS tracks** checkbox toggles them.
3. **Turn walks into escape paths** (Routes panel). Converts the parts of the walks not already on a road or path into 1 m walking paths (GPS wobble smoothed, alleys walked twice kept once, ends joined onto the roads they meet), marked “from GPS walk” for checking. GPS tracks themselves are a record only; evacuation and routing use paths.
4. **Draw or fix paths.** Editors use **Draw path** (2D, satellite):
   - Click along the middle of each alley. Ends snap to roads and other paths (green dot).
   - Set the measured **width** and **who can pass**: on foot, motorcycles too, or cars and fire trucks.
   - Phone GPS is only accurate to about 3–5 m, so use the tracks to see which gap between houses the alley follows, and the photo to place the line.
5. **Routing and evacuation use the paths.** `prepareNetwork` in `public/routing.js` joins each path to the network:
   - an end within 2.5 m of a junction joins it;
   - an end on a road or path within 3 m splits that line into a T-junction.

   Walking routes can use every path. Fire-truck routes use only paths marked for cars and at least the truck's width. With no paths, routing is exactly IgnisShield-Web's.

Shared mode needs `supabase/upgrade-2-field-paths.sql` run once. Raw GPX files belong in `field-data/gpx/`, which is kept out of the repository.


## Evacuation during a fire

Every fire run also shows the residents walking to safety (`public/evac.js`, display in `public/evac-ui.js`). It uses the fire's minute-by-minute result and does not change the fire.

- **Who leaves:** residents of every building the fire comes within 30 m of leave at that minute, or when their own building catches. People per building = households (X6) × 5, the Baliwagan average (2026 census: 6,141 people in 1,209 households).
- **Where to:** the quickest reachable safe place. That is either the **main road** (every junction on a trunk, primary, secondary or tertiary road; the paper describes it as cemented and passable) or a **safe area** that editors add in **Routes → Safe areas** (e.g. a covered court). Safe areas are shared by the class.
- **Route:** each household steps out onto the nearest point on any road or path within 80 m that it can reach without crossing water (sea, river, ponds from OpenStreetMap: `public/data/water.geojson`, made by `scripts/water.mjs`) or passing within 8 m of another burning house (the walk there is counted at half speed: squeezing between houses), then follows the walking network, meaning inventory roads plus the alleys drawn from the GPS walks, with the same travel times as Routes (4.5 km/h, slowed by narrow and crowded streets). People see where the fire is: streets within 8 m of a burning building are closed and streets within 30 m of the fire count 5× longer, so they head away from it. Every minute they check the way ahead; if the fire has blocked it they turn back or take another street (up to 8 times), otherwise they are cut off where they stand. A safe place stops counting once fire is within 16 m of it.
- **On the map:** human figures (families walk in single file, up to 5 figures). Playback is a time-lapse: the speed menu goes from real time (true walking pace) to 240× faster, default 30×.
- **Figures:**
  - **white dots** are walking;
  - **green** reached safety;
  - **red** are cut off (every way out was blocked);
  - **grey** have no mapped road or alley within 80 m.

  Solid green lines are routes along mapped streets. Dotted lines are the walk from home to the nearest mapped one, where the real alley isn't drawn yet.
- **Results and log:** people who left, reached safety, had no safe route or had no mapped path; average and longest evacuation time. Logged per run (`evac_*` columns in the CSV).
- **Limits:** everyone leaves at once and walks at 4.5 km/h, with no crowding, panic or waiting for family, so real evacuations take longer. Routes are only as good as the mapped alleys.


## Optional BFP fire-truck response

Off by default and **not part of the students' paper model**. Tick **Include the BFP fire truck response** in step 2 of the form (`public/bfp.js`, display in `public/bfp-ui.js`):

1. **Call and turnout:** the BFP receives the call after *Call received after* (default 3 min). The truck leaves the station *Crew turnout* later (1 min).
2. **Drive:** it takes the fastest route at *Truck speed* (30 km/h), using the fire-engine road rules (width ≥ 2.5 m, access, one-way) and avoiding roads within 10 m of flames.
3. **Stand-by position:** it parks at the reachable road point closest to the fire, at least 10 m away.
4. **Spraying:** it puts out *Buildings put out per minute* (1) burning buildings within *Hose reach* (60 m), nearest first. Buildings put out turn blue-grey and stop spreading fire. Safe buildings within reach are wetted and catch 4× less easily.
5. **Moving on:** when nothing burns within reach, it drives to the next part of the fire. If no road gets it within reach, the results say so.

All values are drafts to be replaced with BFP figures. The station starts at an approximate spot (Balamban Municipal Hall), because the BFP station is not in OpenStreetMap; editors set the real location with **Set station location**.

The fire acts through an optional hook in `FireModel`. Without it the model is exactly `model.py`, which the parity test confirms. Results show the same fire and replay number with and without the BFP. The log records `bfp_response`, `bfp_first_on_scene_min`, `bfp_buildings_put_out` and `bfp_ignited_without`.


## Model and tests

`public/fire.js` and `public/routing.js` are line-for-line ports of IgnisShield-Web's `backend/model.py` and `engine.py` (model 0.4.0). They use Python's own random number generator, so a seed reproduces the Python run exactly. It is an uncalibrated teaching model with disclosed assumptions, not a forecast.

`npm test` runs three checks. The last two need `IgnisShield-Web/.venv`.

- `tests/paper.test.mjs`: the draft conversions, trials, output units and migration of older saved buildings.
- `tests/parity.mjs`: fire runs against `model.py` on 120 real outlines with 4 seeds and weather settings. Frames, timelines and metrics must be identical, and geometry must match shapely/pyproj.
- `tests/routing-parity.mjs`: 32 routing cases against `engine.run_route` (walking and fire engine, with and without fire exclusion, destinations and checkpoint tours of 3–14 stops). Routes and refusals must match. It takes about 2 minutes. Equal-cost ties that differ only at the 10⁻¹⁰ level are reported as ties.

## Shared class map and hosting

**Online hosting.** The app is static files in `public/`. Vercel serves that folder as-is (`vercel.json`: no install or build step); `npm run vendor` refreshes the committed browser libraries in `public/vendor`.

**Local vs shared mode.** With `public/config.js` empty, everything is saved in each browser (local mode). With a Supabase project URL and anon key in `config.js`, the app switches to shared mode:

- **Buildings:** everyone sees the same buildings, and editors' changes appear live in every open browser.
- **Trial values:** Trials A–D are shared class values that only editors can change.
- **Run log:** editors' runs go into the shared class run log. Runs by viewers and signed-out visitors stay on their own device.
- **Viewing:** anyone with the link can view the map, run fires and find routes.
- **Editing:** only signed-in accounts on the `editors` list can edit buildings, their inputs or the trial values.

**Who can do what.** Email confirmation is off, because Supabase's free mailer cannot reach students. That means an account's email proves nothing, so rights are tied to identities that can't be claimed by typing:
- **Admin:** only the project owner's **GitHub** account, matched by GitHub's permanent account id (BenLorenzoDev = 23088786) in `admin_github_ids`. The admin page `/admin.html` has GitHub sign-in only. The admin can always edit.
- **Editors:** specific accounts the admin approves on `/admin.html`. Students create their own email + password account on the map, tell the owner which email they used, and the owner ticks **Editor**. Only approve an account when you know who made it.
- **Viewers:** everyone else, including signed-out visitors.

**Setting up Supabase (once).**
1. Create a free project at supabase.com.
2. In *SQL Editor*, run `supabase/schema.sql`, then `supabase/upgrade-1-github-admin.sql`.
3. In *Authentication → Sign In / Providers → Email*, turn off *Confirm email*.
4. Create a GitHub OAuth app (GitHub → *Settings → Developer settings → OAuth Apps → New OAuth App*) with the callback URL `https://<project-ref>.supabase.co/auth/v1/callback`. Paste its Client ID and a new Client secret into *Authentication → Sign In / Providers → GitHub* and enable it.
5. In *Authentication → URL Configuration*, set the Site URL to the live site and add Redirect URLs for the live site and `http://127.0.0.1:8780`, each followed by `/**`.
6. Copy the *Project URL* and the *anon / publishable key* into `public/config.js`.

The anon key is public by design; row level security decides who may write. Shared runs can be removed only in the Supabase dashboard.
