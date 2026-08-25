# Finding Real Logs to Test With

Blackbox Lab grows on flight logs. Here is where they live, from
easiest to best.

## 1. The built-in samples (in this repo)

`samples/` contains Rotorflight-style helicopter flights as
genuine binary .bbl files, with `ground-truth.json` describing
exactly what is in them:

- `sample-bell-222ut.bbl` — a real recorded flight (three
  headspeed banks, full ESC + governor telemetry) — the one the
  "Try a Sample Flight" button loads
- `sample-clean-tuned.bbl` — a healthy, well-tuned machine
- `sample-vibration-problem.bbl` — strong 1/rev + tail resonance
- `sample-governor-sag.bbl` — headspeed droops under load
- `sample-academy-*.bbl` — the Diagnosis Academy set: six flights,
  each with one known planted problem (underdamped roll, weak
  feedforward, imbalance, governor droop, dead current sensor,
  stale dump), used by the in-app practice flow

Because the truth is known, they are perfect for testing whether
an analysis finds what it should. Regenerate or customize with:

    node tools/generateSampleLog.mjs

NOTE: these are LOG FILES for the app — recordings of flights.
They are not firmware and cannot be "flashed" to anything.

## 2. Contributed flights (the fleet)

Since v1.x the app can — with the pilot's consent — share
anonymized flights with the project (see
`Documentation/CONTRIBUTED-DATA.md` for exactly what a
contribution contains). The contributed fleet is what every
threshold in the analysis is calibrated against, and it is the
single most valuable asset this project accumulates. The best way
to grow it: keep the app honest and useful, and pilots share.

## 3. Real Rotorflight logs in the wild

- **Rotorflight Discord** — the #blackbox / support channels see
  logs posted daily; ask and most pilots gladly share.
- **HeliFreak forum, Rotorflight section** — tuning threads with
  attached logs.
- **rotorflight-firmware GitHub issues** — bug reports often
  attach .bbl files.

## 4. Non-helicopter logs (decoder testing only)

The openly licensed test fixtures of `Iteratrix/propwash` (and its
upstream sources `ilya-epifanov/fc-blackbox`,
`gimbal-ghost/gimbal-ghost`) carry real Betaflight-family flights —
same binary format family, verified to decode cleanly. Multirotor
logs, not helicopters: great for decoder and chart testing, wrong
field mix for heli-specific analysis.

## 5. Local integration testing

Drop any real log into `test/fixtures/` (gitignored) and the
optional integration test will pick it up:

    mkdir -p test/fixtures
    curl -sL <log url> -o test/fixtures/real.bbl
    npm test
