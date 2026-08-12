# Reading the Findings

How to get from a Blackbox Lab finding to a change on your
helicopter — and when *not* to change anything.

## The shape of every finding

Everything in Blackbox Lab follows the same ladder:

1. **A verdict sentence** — plain language, on the page where the
   evidence lives.
2. **Events** — the single moments behind the sentence. Flight
   Events on the PID page are stick commands with their overshoot
   and settling measured; Headspeed Events in the Governor Lab are
   sustained moments the rotor ran under or over its target. Click
   any event and its evidence unfolds in place.
3. **What To Try Next** — when a *pattern* of events agrees, a card
   names one setting, a direction, and a small step.

## One event is weather. A pattern is feedback.

Wind, a hard gust, one aggressive input — any of them can produce a
single ugly event on a perfectly tuned machine. Blackbox Lab never
recommends from one event, and neither should you. The What To Try
Next cards only speak when at least two comparable events agree and
the evidence confidence is high; below that they say **"Not calling
it yet"** and tell you exactly what is missing.

## The order is not optional

Rotorflight tuning has an order, and the app enforces it in its own
advice:

1. **Vibration & filters first.** Gyro vibration can fake almost any
   tuning symptom. While a vibration finding is open, PID advice
   stays silenced — on purpose.
2. **PIDs second.** Tracking, overshoot, settling.
3. **Governor third.** Headspeed hold, droop, precomp balance.
4. **Power last — and power outranks governor.** A dip with the
   motor output at its ceiling is a power-system limit; no governor
   value can add power that is not there. That finding routes to
   the ESC Lab instead.

## What the common findings mean

- **"Settled slowly, circling the setpoint"** — the axis has the
  drive to reach its target but not the damping to stop there. The
  usual first step is a small increase of that axis's D gain.
- **"Settled slowly, I-term carrying the command"** — in
  Rotorflight, feedforward is supposed to do the work during
  commanded motion. Creeping to target with a dominant I-term
  usually means feedforward has room to come up.
- **"Rotor over target after a collective drop"** — the governor's
  collective precomp is still feeding power the load no longer
  needs. A small step down on `gov_f_gain` (or more governor
  damping) absorbs it.
- **"Droop on collective rises, clean drops"** — the opposite case:
  anticipation running behind the load. A small step up on
  `gov_f_gain` asks for the power before the load arrives.
- **"Tail kicked by collective moves"** — torque anticipation, not
  tail tuning. The knob is the collective-to-yaw precomp
  (`yaw_collective_ff_gain`); its direction depends on your rotor's
  rotation direction, which a log does not state — step once, and
  if the kick grows, go the other way.

## The loop

Change **one** thing. Fly the same kind of moves again. Open the new
log and let **Compare Flights** judge — every suggestion in the app
names the exact number that should improve. If it did not, change it
back; the log will still be there.

Blackbox Lab never writes settings to your helicopter. It recommends
and explains; the pilot always makes the final decision.
