# Blackbox Lab

**Professional Rotorflight Analysis Suite**

> **Simple first. Deeper when you want it.**

Blackbox Lab is an open-source desktop application designed to make Rotorflight Blackbox log analysis simple for beginners while remaining powerful enough for advanced pilots.

## What Blackbox Lab is—and is not

**Blackbox Lab is not an AI-driven flight-analysis system.** Its findings come from recorded Rotorflight log data processed through programmed formulas, thresholds, and rules. AI assisted during development, testing, wording, and interface work, but it does not analyze flights or decide what changes a helicopter needs.

**You do not need to understand blackbox logs, filters, or PID tuning to use it.** Blackbox Lab is designed to turn complex flight data into clear, plain-language findings, while still allowing experienced users to inspect the deeper evidence.

---



## Download

Ready-made installers for **Windows, macOS and Linux** are on the
[Releases page](https://github.com/hillbilly1975/Blackbox_Lab/releases/latest)
— download, install, open a log. No build tools needed.

macOS comes in two builds: `darwin-arm64` for Apple Silicon (M1 and
newer) and `darwin-x64` for Intel Macs. **About This Mac** tells you
which you have.

Because the app is not signed with a paid Apple developer
certificate, macOS quarantines it after download. On **Apple
Silicon** this shows up as *"Blackbox Lab is damaged and can't be
opened"* — the download is fine; that message is just macOS being
protective about unsigned apps. Clear the quarantine flag once and
it opens normally from then on. In Terminal:

```
xattr -cr "/Applications/Blackbox Lab.app"
```

(Move the app into Applications first, then run the command —
cleared elsewhere, macOS may still show the same message again.)
On **Intel** Macs, right-click → Open on first launch is usually
all it takes.

---

## What It Looks Like

**Open a log — get answers, not data.** Every flight lands on a
plain-language verdict with a "what to do" line and one-click
evidence:

![Flight Verdict](Documentation/screenshots/flight-verdict.png)

**Evidence you can see.** The Filter Lab's noise spectrum labels
each peak with its likely mechanical source:

![Filter Lab](Documentation/screenshots/filter-lab-spectrum.png)

**Did your change help?** Compare two flights and get the answer
in one sentence per topic:

![Compare Flights](Documentation/screenshots/compare-flights.png)

## Mission

Most Blackbox tools assume you already know how to read logs.

Blackbox Lab explains what happened during the flight using plain English and provides recommendations that help improve tuning, reliability, and confidence.

---

## Working Today

- **Native .bbl decoding** — open raw Blackbox files straight off
  the flight controller, no CSV conversion. Multi-flight files
  supported, corrupt bytes skipped gracefully — and loading is
  fast: large logs open in seconds.
- **Flight Verdict** — answers first: seven plain-language cards
  (vibration, rotor speed, tuning, power & ESC, battery, signal,
  BEC) with status, cause, what to do, and a jump straight to the
  evidence.
- **What To Do First** — every finding of the flight in one
  severity-ordered list; upstream problems outrank downstream
  tuning, so filters come before PIDs and power before governor.
- **Flight Change Packs** — the earned changes of a flight as one
  reviewable plan: at most three setting changes, each verified by
  its own instrument on the next log, with mechanical fixes named
  alongside. With a CLI dump loaded, the pack becomes a paste-ready
  CLI snippet with a guaranteed-undo revert; the next log checks
  the pack automatically.
- **Seven labs** — Filter, PID, Governor, ESC, Battery, Signal and
  BEC. Each opens with its verdict, a Try This First and the key
  chart; the tables and raw numbers sit behind one "Show the
  advanced data" control.
- **Flight Events** — every stick command with its measured
  response: overshoot, settling, bounce-back, ringing. Click an
  event and its card, description and windowed chart show the same
  moment, stick playback included.
- **Replay** — fly through the log again: synchronized playhead,
  stick overlays, preset views, and a searchable browser for every
  field the log recorded, stacked as charts in a dashboard you
  arrange.
- **PID profiles & headspeed banks** — per-profile segmentation and
  per-bank verdicts, with cross-axis effects analyzed and
  under-sampled banks never crowned "best".
- **Servo Travel Check** — servo commands pinned at their travel
  limit mid-maneuver are a mechanical finding, not a tuning one.
- **Noise spectrum & Filter Advisor** — built-in FFT with peaks
  classified against rotor harmonics, filter attenuation measured
  unfiltered-vs-filtered — mechanics first.
- **Compare Flights** — before vs after with its footing checked:
  demand, maneuver coverage, headspeed and evidence quality must
  match before a causal verdict, and the verdict states its
  confidence.
- **Health Record** — every analyzed flight filed per craft
  (locally); trends appear when enough comparable flights exist,
  never from two points.
- **The Diagnosis Academy** — seven sample flights: Daniel's real
  Bell 222UT recording ("Try a Sample Flight", one click) plus six
  practice flights, each with one known planted problem and a
  reveal to check your diagnosis against. Recordings for the app —
  not firmware; they cannot be flashed to anything.
- **PDF flight reports** — verdict, priorities, the Change Pack,
  every lab and the charts in one compact, shareable PDF, worded
  exactly as the app.
- **Log Quality Gate** — before analysis, the app tells you what
  this log can and cannot answer, and which logging settings to
  enable for more. Missing telemetry reads "not measured", never a
  fake score.
- **Beginner & Advanced modes** — calm by default, everything laid
  out when you switch; any single page can show its advanced data
  temporarily.
- **Update check** — a quiet banner when a newer release exists.
- **Community log sharing** — strictly opt-in and anonymized:
  contributed logs calibrate the analysis for everyone. Off until
  you say yes; details in
  [Documentation/CONTRIBUTED-DATA.md](Documentation/CONTRIBUTED-DATA.md).

## On the Roadmap

- Video Overlay Export
- Direct FBL Access
- Setup Wizard / Configuration
- Web App

The longer list lives in
[Documentation/BLACKBOX_LAB_ROADMAP.md](Documentation/BLACKBOX_LAB_ROADMAP.md).

---

## Design Philosophy

Simple first.

Deeper when you want it.

---

## Running From Source (developers)

```
npm install
npm start        # run the app
npm test         # run the test suite
```

Then click "Open Blackbox Log" and pick a `.bbl`, `.csv` or CLI
dump — or try `samples/sample-bell-222ut.bbl` (a real
recorded flight) and visit
the Filter Lab.

## Status

🚧 Active Development

Built with Electron and JavaScript.

## License

Blackbox Lab is free software, licensed under the
[GNU General Public License v3.0](LICENSE) — in line with the wider
Rotorflight and Betaflight ecosystem. Copyright (C) 2026 Daniel Sink
and contributors.
