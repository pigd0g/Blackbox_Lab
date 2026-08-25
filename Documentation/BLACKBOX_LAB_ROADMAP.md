# BLACKBOX LAB ROADMAP

## Mission

Build Blackbox Lab into the professional RotorFlight analysis suite that is simple for beginners while remaining powerful for advanced pilots.

Simple first.
Deeper when you want it.

---

# Core Principles

- Blackbox Lab NEVER changes RotorFlight settings.
- Blackbox Lab only recommends changes.
- Blackbox Lab explains WHY.
- Every recommendation must be supported by evidence.
- The pilot always makes the final decision.

---

# Where the vision stands (v1.8.0)

The founding roadmap asked for an evidence engine, a guided
workflow, teaching over recommending, professional reports, and a
beginner/advanced split. As of v1.8.0 that core is shipped:

- **Evidence engine** — every recommendation names its events, its
  confidence, and the metric that will verify it on the next log;
  thin evidence is named, not papered over.
- **The tuning order, enforced** — vibration and filters gate PID
  advice; power findings outrank governor findings; the app's own
  advice follows the order it teaches.
- **Teaching** — every verdict explains why, in plain words;
  the Diagnosis Academy ships six practice flights with known
  planted problems to learn diagnosis on, risk-free.
- **Change Packs** — the recommendation, direction, reason and
  verifying metric as one reviewable unit, checked automatically
  against the next flight; applied by the pilot, never by the app.
- **Reports** — a compact PDF carrying the verdict, priorities,
  pack, labs and charts, worded exactly as the app.
- **Simple first, deeper on request** — every lab opens with the
  verdict, Try This First and the key chart; the tables and raw
  numbers live behind one "Show the advanced data" control.
- **The fleet** — all scoring calibrated against contributed
  flights, refreshed as the fleet grows.

---

# Roadmap

Next, in no promised order:

## Video overlay export

Render a flight's key traces (sticks, events, verdict moments) as
an overlay track for flight video — the log and the footage telling
one story.

## Direct FBL access

Read logs (and the configuration needed to explain them) straight
from the flight controller over USB — no SD card shuffle. Reading
only: the no-write principle stands.

## Setup Wizard / Configuration

Guide a pilot from a fresh flash to a safe first log: verify the
setup basics, confirm what the log will record, and make the first
analysis a one-click path. Recommendations stay recommendations.

---

# Design Philosophy

Clean

Professional

Simple

Fast

Minimal clicks

No clutter

---

# Goal

Make RotorFlight feel as approachable as iKon2 or Spirit while remaining technically accurate enough for professional pilots.
