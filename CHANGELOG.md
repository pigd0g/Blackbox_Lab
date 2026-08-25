## v1.8.0 — The 180 Edition

Everything between v1.3.0 and here, in one entry — a
field-feedback release series: every item below was shaped, retested and signed off
by the community test round.

### The big ones

- **Change Packs** — each flight ends with concrete setting changes
  (setting, direction, reason, verifying metric on the next log), or
  the evidence flight that would earn one. Previous packs are checked
  against the next log automatically.
- **Replay: all logged fields** — a searchable, grouped field browser
  stacks any recorded channel (PID terms, mixer, servos, governor,
  ESC telemetry, debug) on the synchronized timeline; chart legends
  keep exact field names.
- **PDF reports** — one compact A4 file: verdict, What To Do First in
  priority order, the Change Pack, like-for-like data, every lab and
  the charts, worded exactly as the app.
- **Compare Flights: like-for-like check** — flight demand, stick
  demand per axis, maneuver coverage, headspeed, collective work,
  length and evidence quality compared before any verdict, with the
  verdict confidence stated; non-comparable pairs read as
  observations, the same flight twice reads as a self-check.
- **Roughly 4× faster log loading**, with results verified identical.

### Honesty and evidence

- Under-sampled headspeed banks are never rated "best" or "cleanest";
  per-bank evidence (seconds, confidence) is shown everywhere.
- One priority rule across Home, the pack, the labs, Technical and
  the report: the same flight names the same primary finding on
  every surface.
- Missing telemetry appears as greyed "not logged" cards plus a
  "Not measured on this flight" list naming the sensor or setting.
- BEC verdicts speak in sustained readings and disclose brief raw
  dips; a tracking score read through an open vibration finding, or
  from thin evidence, is never called crisp.
- Health Record: no trend lines under four flights, comparability
  differences named, one flight is one row whatever build analyzed it.
- Flight Events: one stick movement is one event; the selected
  event's card, description and windowed chart always show the same
  moment, with the measured-response band drawn on the chart.

### Simpler by default

- Lab pages open with the verdict, Try This First and the key chart;
  tables and raw numbers live behind one "Show the advanced data"
  button per page, and folds open themselves when they hold a
  finding.
- The Diagnosis Academy: six practice flights with a known planted
  problem, reachable before and after loading a log.
- A declared type scale and a full legibility pass: reading text
  never below 16px, results uniformly emphasized, shorter sentences
  and cleaner paragraphs throughout.
- Sidebar and report credit: a passion project by Daniel Sink and
  Vincent Offenbeck.

## v1.3.0 — Signal Lab, BEC Lab, and the Confirm Round

Built from the field's own verification pass of v1.2.0: six
refinements confirmed against real logs, plus two new labs that
extend the mission from tune and power to the radio link and the
receiver's own power supply.

### New: Signal Lab

- "Was the radio link healthy the whole flight?" — signal strength
  judged against this flight's own typical level (never an absolute
  threshold: protocols scale these numbers differently), with the
  firmware's failsafe and signal-valid flags as the only authority
  on loss of control. A telemetry hiccup is never read as loss of
  control, and fields the log doesn't carry report Not Evaluated.

### New: BEC Lab

- "Did the receiver and servos receive stable power?" — the
  reference is the flight's own median voltage, so a system
  deliberately running 6.0 V is never judged against one running
  8.4 V. Dips are judged by depth, duration and repetition
  together, each with its servo-demand context: voltage following
  hard servo work is load; voltage sagging with the servos quiet
  points at wiring, connectors or the BEC. Brownout language
  appears only near the absolute floor where receivers genuinely
  let go — and when the receiver kept reporting a healthy link
  through a "brownout" reading, the lab says what that means: a
  measurement-path story, not a power loss.
- When a link event and a power event overlap, each lab points at
  the other — correlation named, causation never claimed.

### Flight events

- A command that materially reverses direction before ever holding
  now ends at the reversal: several slurred movements can no longer
  anchor as one event measured against a target from seconds later,
  and the response-peak marker always belongs to the command the
  card names. Response measurements end at the settled point.

### Consistency

- Compare Flights' spectrum caption follows the page's own
  comparability ruling — no "shrinking peaks = progress" between
  two different machines.
- The exported report's Governor Lab status now renders the same
  capability state the app shows: a partial (stability-only)
  analysis is never labeled with a scored-quality word.
- Governor Lab help opens with what the current log can support;
  Filter Lab help keeps mechanics-first for real mechanical
  evidence without implying every well-managed harmonic needs a
  wrench; PID Lab help now defines bounce-back, oscillation,
  still-approaching and sustained PID-term activity.

## v1.2.0 — The Events-Integrity Round

The community's first deep-review wave — issues on the events
analysis, the governor verdict, battery sag and servo limits, plus
a real before/after tuning case from the field — answered in one
build. The theme throughout: every number the app shows must be the
answer to the question it claims to answer.

### Flight events, rebuilt

- A command event now means a real stick step (20 deg/s or more)
  toward a target that holds still. Tiny nudges and still-moving
  targets are not step responses and are no longer scored.
- Overshoot only exists after the response actually reaches the
  target, only while it persists past it, and is bounded by
  settling — the response-peak marker always points at the moment
  it names. Reported in deg/s alongside percent, and both must be
  meaningful for the verdict to fire.
- Two new verdicts: **oscillation** — the response swings across
  the target repeatedly, bigger than the command itself — and
  **still approaching** — the response had not arrived when its
  window closed. Both were previously lumped into other labels.
- All response measurements run on a lightly smoothed trace, so a
  single noisy sample can no longer fake a peak or break a settle.

### Governor Lab

- Multi-bank flights get one verdict row per commanded headspeed
  bank — average, dip and percent against that bank's own target.
  A cross-bank average describes nothing the pilot commanded.
- Commanded bank changes no longer register as droop, and a dip
  with the motor output at its ceiling is named a power-system
  limit, pointing at the ESC Lab instead of governor gain.

### ESC and Battery

- Load-event sag is measured against the pack's level just before
  each event, and the table shows both voltages — the reference is
  visible, never implied. Ordinary discharge no longer reads as
  event sag.

### New: Servo Travel Check

- The PID Lab watches for servo commands frozen at the edge of
  their own travel while the controller is actively working — the
  servo-level confirmation of a saturation condition. Each event
  lists time, edge, duration and command value. Silent on logs
  without servo data.

### Scores that name their demand

- A tracking score from a gently flown flight now says so ("at
  gentle demand"), carries Medium confidence, and Compare Flights
  shows — but does not subtract — scores from flights flown at
  different intensities.

### Calibration

- Every fleet-anchored threshold behind the event verdicts and the
  What To Try Next gates was re-measured on the contributed corpus
  (370 flights) under the new measurement.

## v1.1.0 — The Recommendation Engine

v1.0.0 finished the analysis half of the mission; this release starts
the other half the roadmap always promised: recommendations,
explained and evidence-backed, with the pilot deciding. It was asked
for by the first users of v1.0.0 within hours of the release — this
is that answer.

### The big ones

- **What To Try Next.** The PID and Governor Lab pages now carry
  recommendation cards. Each one states the finding, teaches the
  mechanism behind it, and — only when enough evidence agrees —
  names ONE setting family, a direction, and a small step, followed
  by its verify plan: change the one thing, fly the same moves, and
  the card names the exact number that must improve. Below the gate,
  the same card says plainly what is missing ("Not calling it yet").
  Advice is confidence-gated (at least two comparable events, high
  evidence confidence, no conflicting higher-priority finding) and
  respects the tuning order in code: an open vibration finding
  silences PID advice, a power limit silences governor advice.
- **Headspeed Events.** The Governor Lab gains the event layer the
  PID page already had: every sustained moment the rotor ran over or
  under its governed target shows as a card on a time axis — click
  one and its evidence unfolds in place, target vs headspeed and
  motor output vs collective on one clock, with the pilot's hands
  beside it when the log carries stick telemetry. Each event is
  classified from its context: power-limit, load droop, overspeed
  after a collective drop, with post-event hunting flagged. The
  event band is fleet-calibrated on 247 contributed flights: the
  median governed machine reads zero events.
- **Precomp Balance.** Precomp is never logged, but how well the
  anticipation worked is. The Governor Lab's advanced view now reads
  the flight's own fast collective moves both ways: droop on rises
  with clean drops = precomp behind the load; overspeed on drops
  with clean rises = precomp past it; missed both ways = a
  response-speed story, routed to the ESC Lab. The tail gets the
  same treatment — a tail kicked consistently by collective moves is
  torque anticipation, not tail tuning, and the card says which knob
  that is and how to verify the direction.
- **Reading the findings.** The How-to-Use guide gains the chapter
  users asked for — how events, patterns and recommendations relate,
  and when NOT to change anything — plus a fuller written version in
  `Documentation/READING_THE_FINDINGS.md`.

- **The overshoot driver, answered carefully.** Repeated overshoot
  now gets its own recommendation — and the engine reads what
  drives it before naming a knob: overshoots that ring point at
  damping; overshoot growing with how FAST the command moved
  carries the feedforward signature; growing with how BIG the
  command was, the proportional one. When the driver is not
  separable from the log, the card says so and names both knobs in
  doctrine order, feedforward first, one at a time.
- **Precomp trends across flights.** The Health Record now tracks
  each flight's precomp reads — rise-side droop, drop-side
  overspeed, tail kick ratio — and warns when they worsen across
  sessions, the way it already watches vibration and droop. Trends
  on metrics that live near zero carry an absolute floor, so a
  rise from nothing to almost nothing can never read as a
  deterioration.

- **The loop actually closes.** Every recommendation names the
  number the next log must improve — and Compare Flights now shows
  those exact numbers: stick-response events needing review,
  headspeed excursion counts, the precomp balance reads, the tail
  kick ratio. The shareable report carries the What To Try Next
  cards, the excursion summary and the precomp reads, so the second
  pair of eyes sees what the pilot sees. And the tuning order is
  enforced everywhere: an open vibration finding silences governor
  advice exactly as it silences PID advice — including the tail
  read, which is measured from the most vibration-sensitive signal
  of all.

### Also in

- Governor & precomp settings from the craft's saved configuration
  shown beside the events they produced (advanced view).
- The governor verdict sentence carries the excursion summary when
  events exist; headspeed excursions ride the Replay scrub bar
  beside the stick-command ticks; the Technical PID analysis
  drilldown says in one line how it relates to the What To Try Next
  card above it.
- The contributed-data description now names the derived analysis
  results that travel with a contribution — command events,
  excursion events, precomp reads — and the in-app sharing
  description says the same.
- Contribution schema 1.2: governor excursion events and the
  precomp balance reads now travel with contributed flights — the
  same allowlist-on-write, consent and caps as the command events;
  pilot-facing text never uploads.
- The ingest guide gains browser-only steps for updating the
  worker, and describes the addressed bucket layout (one folder
  per distinct flight, error reports in their own area).
- Stick insets across the app now hide cleanly on logs without
  rcCommand telemetry instead of rendering an empty box.

## v1.0.0 — Blackbox Lab

The first full release. Everything below grew out of months of test
rounds on real flights — MD500E, Bell 222UT, nitro machines, ESC- and
externally-governed models — and out of the issues those rounds
surfaced.

### The big ones

- **Replay.** A new tab that plays the flight back like a video edit:
  stack the charts you want from nine presets (per-axis target vs
  gyro, filtered/raw gyro, headspeed & target, collective, motor
  output, voltage & current), reorder them freely — the layout is
  remembered. One shared timeline: the playhead runs through every
  chart at once, Flight Events sit as colored ticks on the scrub bar,
  live headspeed/voltage readouts follow, playback speed 0.25×–2×.
- **Pilot input on screen.** Transmitter-style stick displays with
  live deflection numbers — in Replay, and beside the evidence in the
  PID event view (replays the pilot's hands through each event),
  the Governor worst-droop card and the ESC peak-load card, all
  hover-scrubbed with their charts. Stick mode (1–4) is a Settings
  choice and the display labels the mode it renders with.
- **Home redesign.** Verdict cards as a tile grid, Flight Events as a
  clickable timeline with in-place evidence, the 3×3 tuning matrix,
  chart maximize, and a friendlier welcome screen.
- **Evidence-first analysis language.** Every Lab now separates what
  was detected from what it means: Filter Lab distinguishes
  detection, filtering effectiveness, control impact and
  recommendation (a well-filtered peak reads "managed by filtering",
  never as a fault); Governor Lab reports full, partial
  (headspeed-only — stability and swing, never "droop" without a
  target) or not-evaluated; scores are never shown without the
  evidence to back them.
- **Fleet-calibrated scoring.** Filter, PID tracking and governor
  scores are calibrated against hundreds of real contributed flights
  — continuous scales anchored to what real machines actually do,
  instead of thresholds guessed from one log.

### Also new since v0.3.9

- Screen intros on every analysis page — a what-am-I-looking-at
  paragraph with the deeper explanation folded behind it, now
  carrying each Lab's help (what it uses, what it cannot prove, how
  partial telemetry changes the conclusion).
- Flight Events with stable identity end to end: card, description,
  chart window and technical findings always describe the same
  event; the window always contains the event.
- Health Record: one physical flight is one row — re-analysis after
  an update refreshes the row instead of adding a duplicate;
  existing duplicates fold together on first launch.
- Contribution schema v1: content-hash dedup, consent snapshot,
  anonymization report, per-craft CLI-dump attachment with a strict
  allowlist scrubber, craft cards, upload ledger.
- Error reporting: a crash offers a one-click, flight-data-free
  report (or copy-to-clipboard) — once per distinct failure.
- Per-headspeed-bank breakdowns in PID and Filter Labs, governor and
  ESC evidence views, collective-load cause on ESC events, craft
  identity panel with dump-driven prefill, per-flight delete in the
  Health Record, English document language throughout.

### Changed

- **License: GPL-3.0** — in line with the wider Rotorflight and
  Betaflight ecosystem.
- Advanced mode: nothing is invisible — advanced blocks are always
  present, folded; the sidebar switch pre-opens them.

## v0.3.7 — release plumbing

### Added

- **Downloads for Intel Macs.** Releases now build a
  `Blackbox.Lab-darwin-x64-…zip` alongside the Apple Silicon package,
  so Macs from before 2020 are covered. Pick the one matching your
  machine — About This Mac says "Apple M…" or "Intel Core…".
- `Documentation/RELEASING.md` — the release steps in the browser,
  what each version file controls, and what to check if a build does
  not start.

### Changed

- The release build confirms the tag and the two version files agree
  before it builds anything, so any mismatch surfaces in about a
  minute with a message naming the file to update.

## v0.3.5 — the tuning charts release

### Added

- **Per-axis tuning preset charts** (from Ben Britton's feedback):
  the Log Viewer's single roll-only Setpoint-vs-Gyro chart is now
  three cards — Roll, Pitch and Yaw Tuning — each with three
  ready-made presets: Tracking (target + gyro), Feedforward check
  (+ I-term: I near zero while tracking = FF carrying the
  maneuver, as Rotorflight intends) and Term balance
  (target + P/I/D). Beginner mode shows Tracking only; Advanced
  mode lays everything out. Colors mean the same thing on every
  chart: blue target, orange gyro, green I, amber P, magenta D.
- **Remove individual flights from the Health Record**: every row
  in the Logged Flights table has a ✕ button — one bad log no
  longer means wiping the whole record. Trends recompute without
  the removed flight; Clear all history stays for the full wipe.
- The HTML report now includes the tracking chart for all three
  axes (was roll only).
- **Governor Lab: "The Worst Droop, In Context"** — the seconds
  around the biggest dip on one linked clock: target/actual RPM
  and error, motor output + collective, voltage + current, and
  the log's own recorded governor P/I/D/F/Sum terms (shown only
  when genuinely present, never estimated from throttle).
- **ESC Lab: "Highest-Load Moments"** — the hardest-working
  seconds with a plain-language cause each (at the limit /
  battery sag / normal load), a synchronized view of output,
  current + voltage, power and ESC temperature around the
  biggest event, and stable-flight averages per governor bank.
  ESC temperature telemetry is read for the first time.
- Charts in these views share their zoom — drag on one and the
  others follow. All scoring is untouched: evidence only.
- **PID Lab: "Tracking By Headspeed Profile"** — per-bank,
  per-axis tracking error plus an overshoot measure, because
  helicopters behave differently at different headspeeds.
- **Filter Lab: "Noise By Headspeed Profile"** — one spectrum
  per governor bank from that bank's own stable flight time,
  with peak classification and filter advice at that bank's
  actual rpm. Rotor harmonics move with headspeed; the combined
  spectrum can average away a peak that only one bank sees.
  Both per-profile cards appear when a flight visits two or
  more banks; scoring is untouched.
- **ESC load events understand collective**: the synchronized
  event view now includes the collective trace, and when an
  event's collective demand nears the flight's own maximum the
  reading becomes "Collective load" — the sag was a response to
  the load, not necessarily evidence of a weak pack.
- The sidebar now shows the app version.
- **The sample flight is now a real flight**: "Try a Sample
  Flight" loads a genuine recorded log with three headspeed
  banks and full ESC + governor telemetry, so the tour shows
  every card in the app — including the per-profile views.
  Bundled samples are never sent to the community bucket.

### Fixed

- The UI smoke test now asserts that all nine preset charts
  render with scaled data.

## v0.3.4 — feedforward doctrine + release repair

Builds directly on v0.3.3's scoring cleanup.

### Fixed

- Sustained feedforward output is no longer scored as PID-term
  saturation. In Rotorflight, feedforward is supposed to do the
  work during commanded motion, so sustained feedforward drive is
  now reported as expected behavior (informational, no score
  deduction). The v0.3.3 command-balance assessment remains the
  feedforward health signal and the verdict text now points at it.
- `src/version.js` now matches `package.json` again — v0.3.3
  installs showed a permanent "update available" banner. A new
  test keeps the two versions in lockstep from now on.
- v0.3.3's release tag was missing the `v` prefix, so the
  installer build never ran and its release page has no downloads.
  v0.3.4 (tagged `v0.3.4`) is the first downloadable build that
  carries all of the v0.3.3 fixes.

### Added

- Feedforward doctrine tests and the version lockstep test
  (suite: 49 tests).

## v0.3.3 — evidence and scoring cleanup

### Fixed

- Stable-flight detection now supports both full headspeed/governor-target logs and headspeed-only logs.
- Governor tracking and droop scoring are withheld when governor-target telemetry is unavailable.
- Overall Score now shows `N/A / Not Scored` when no performance systems are available for scoring.
- ESC and Governor sections now show explicit unavailable states instead of creating misleading scores.
- Missing evidence no longer produces false 100/100 Filter results.
- Filter Advisor peak detection now uses prominence above the local noise floor instead of raw FFT magnitude alone.
- Unavailable governor evidence no longer increases analysis confidence.
- Removed temporary application debug logging from analysis and rendering modules.
- Tightened recommendation wording so incomplete evidence does not produce unsupported tuning advice.

### Verified

- Bell BBL and matching CSV agree at 94/100 overall.
- Bell Governor result remains 83/100 — Watch.
- Stable-flight governor dip remains 22 RPM / 1.2%.
- Kraken headspeed-only logs still render Noise Spectrum and Filter Advisor while correctly withholding unsupported scoring.
- Test suite: 45 total, 44 passed, 0 failed, 1 skipped.
# Changelog

## v0.3.0 — "The Birthday Build, Part Two" (same evening)

The answers layer, completed:

- **Flight Verdict** — after every log the app lands on
  plain-language answer cards (vibration, rotor speed, tuning,
  battery) with status, cause, a "what to do" line and a
  show-me button that jumps to the evidence — zoomed to the
  exact frequency band or second where it happened.
- **Governor / ESC / Battery Labs** — real analyses with stories
  and metric tiles: droop % with a worst-droop marker on the
  chart, throttle headroom & saturation time, voltage sag,
  estimated internal resistance and consumed mAh.
- **Compare Flights** — before vs after with significance-aware
  deltas ("your change made the biggest vibration peak 86%
  better; nothing got worse") and an overlaid spectrum.
- **Health Record** — every analyzed flight filed per craft,
  locally; trend warnings when vibration, droop, internal
  resistance or tracking drift the wrong way across flights.
- **How to Use** — a five-step in-app guide with a no-jargon
  glossary; "Try a Sample Flight" needs one click and no file
  dialog; beginner mode by default, advanced on demand.
- Friendlier looks (same dark & blue soul), a sidebar credit,
  amplitude-calibrated FFT, spool-up excluded from spectra,
  unfiltered-gyro-first noise analysis, and a Playwright UI
  smoke test that loads the app and asserts the verdict renders.

## v0.2.0 — "The Birthday Build" (2026-07-22)

A gift from your friends at EGODRIFT. Happy birthday, Daniel. 🚁

### The headline

**Blackbox Lab now reads raw .bbl files natively.** No external
conversion, no CSV exports — open the file straight off the
flight controller, including files holding several flights.
Exactly as you put it: the raw data can build a better story of
the helicopter and see things the CSV log doesn't show.

### Added

- Native binary BBL decoder, implemented clean-room from the
  published Blackbox format specification, no code copied: all
  standard encodings and predictors, multi-flight files,
  corruption resync, end-of-log events. Validated against real
  Betaflight-family logs (24,893 frames, zero corruption) and
  spec reference vectors.
- Charts, everywhere it matters: gyro, setpoint-vs-gyro
  tracking, headspeed/governor, motor & power (uPlot, drag to
  zoom) — plus a noise spectrum in the Filter Lab powered by a
  built-in FFT. The teaching layer your vision asked for.
- Real navigation: every Lab is a screen now.
- Sample flight generator + three ready-made flights in
  `samples/` with known ground truth (vibration frequencies,
  governor behavior) — practice logs for users without a log at
  hand, and test fixtures for every future analysis.
- Test suite (18 tests) and GitHub Actions CI.
- Documentation: developer guide, finding-test-logs guide.

### Unchanged — deliberately

- Every analysis module you wrote. The decoder feeds them
  through a CSV adapter; your code is the heart of the app.
- Your product philosophy. It's the best part of the project.
