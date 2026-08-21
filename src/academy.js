// ======================================================
// DIAGNOSIS ACADEMY — practice flights with a known answer
// ======================================================
//
// Each entry loads a bundled synthetic flight with exactly
// ONE planted problem. The pilot explores the labs, forms a
// diagnosis, then reveals the answer — the reveal walks the
// same evidence chain the app itself used, teaching how the
// instruments think.
//
// Every academy flight is generated (tools/generateSampleLog
// .mjs) with the defect planted to known ground truth and
// verified against the engine: each trips its own instrument
// at the fleet bars and stays quiet on the others. No real
// pilot's log ships here without their explicit permission.
//
// ======================================================

export const ACADEMY_ENTRIES = [
  {
    id: "imbalance",
    file: "sample-academy-imbalance.bbl",
    title: "The heli that shook itself blurry",
    teaser: "Feels rough everywhere, but the tune looks fine. Where do you look?",
    brief:
      "This machine flies its maneuvers well enough — and still " +
      "something is clearly wrong. Explore the Vibration and " +
      "Signal labs, then check what the tuning instruments say. " +
      "When you think you know the root cause, reveal the answer.",
    reveal: {
      diagnosis: [
        "The gyro spectrum shows a strong peak at the main rotor's " +
          "once-per-revolution frequency (about 30 Hz at this " +
          "headspeed) — the signature of rotor imbalance, not of any " +
          "tuning value.",
        "The filters remove most of it, but the residual still " +
          "reaches the control loop — and it even shows up as an " +
          "apparent yaw ringing Review. That is vibration wearing a " +
          "tuning costume.",
        "This is why the recommendation engine holds tuning advice " +
          "while a mechanical source is suspected: chasing gains " +
          "here would tune around a bent cause."
      ],
      fix:
        "Mechanics first: balance the blades and head, check " +
        "bearings and grips, then fly again. The spectrum peak " +
        "shrinking is the proof — no PID value can provide it."
    }
  },
  {
    id: "underdamped-roll",
    file: "sample-academy-underdamped-roll.bbl",
    title: "The roll that always came back",
    teaser: "Crisp inputs, but something rebounds. Which axis, and why?",
    brief:
      "Fly through the Response Review and the per-axis event " +
      "evidence. One axis behaves differently from the other two. " +
      "When you can name the axis and the pattern, reveal the answer.",
    reveal: {
      diagnosis: [
        "Roll bounce-back sits far above the fleet bar: after each " +
          "roll command peaks, the response swings back through the " +
          "target instead of settling onto it.",
        "Pitch and yaw show no such pattern — the defect is " +
          "axis-specific, which points at that axis's damping, not " +
          "at anything global like vibration or filters.",
        "This is the signature of an underdamped axis: too little " +
          "damping authority for the response speed asked of it."
      ],
      fix:
        "More roll damping (the D-family on that axis) or a gentler " +
        "roll response, then confirm with the same crisp roll " +
        "inputs — the bounce-back median on the next log is the " +
        "instrument that verifies exactly this change."
    }
  },
  {
    id: "weak-ff",
    file: "sample-academy-weak-ff.bbl",
    title: "The heli that leaned on I",
    teaser: "It gets there — late, and by the wrong route. Which term does the work?",
    brief:
      "Tracking looks acceptable at a glance. Open the command " +
      "balance evidence and look at WHICH PID term carries the " +
      "commands. When you can say who does the lifting, reveal " +
      "the answer.",
    reveal: {
      diagnosis: [
        "During command windows the I-term dominates while P plus " +
          "feedforward barely contribute — the command-balance " +
          "instrument flags exactly this on the highest-error axis.",
        "The machine still follows the stick, but by integrating " +
          "error after the fact instead of being fed the command " +
          "up front. That is why it feels late and slightly rubbery.",
        "Nothing here is saturated and nothing rings — with weak " +
          "feedforward, balance is the instrument that sees the " +
          "problem while the others stay quiet."
      ],
      fix:
        "Raise feedforward so the command reaches the rotor " +
        "directly. The verifying instrument: on the next log the " +
        "I-share during commands drops and support rises — the same " +
        "balance numbers that flagged it."
    }
  },
  {
    id: "governor-droop",
    file: "sample-academy-governor-droop.bbl",
    title: "The headspeed that gave way",
    teaser: "Every climb costs rotor speed. How much, and what pays it back?",
    brief:
      "Open the Governor lab and watch headspeed against its " +
      "target through the collective climbs. When you can say what " +
      "happens under load — and roughly how much — reveal the answer.",
    reveal: {
      diagnosis: [
        "Headspeed sags several percent every time collective load " +
          "arrives, and recovers slowly — classic governor droop.",
        "The droop shows only under load: in the hover segments the " +
          "hold looks perfect. Judging a governor by its hover is " +
          "how this problem hides.",
        "Cyclic instruments stay quiet: this is a governor-domain " +
          "finding, and the engine keeps governor changes in their " +
          "own lane because held headspeed is what makes the other " +
          "instruments comparable at all."
      ],
      fix:
        "More governor gain (or precomp for the load it can see " +
        "coming), then the same climbs again. The verifying " +
        "instrument is flight droop percent under load — not the " +
        "hover average."
    }
  },
  {
    id: "dead-current",
    file: "sample-academy-dead-current.bbl",
    title: "The sensor that read nothing",
    teaser: "The power sums don't add up — or rather, they don't exist.",
    brief:
      "Open the Battery lab and look for the current story. " +
      "Something every other lab report has is missing here. When " +
      "you know what — and what the app does about it — reveal the " +
      "answer.",
    reveal: {
      diagnosis: [
        "The current sensor reports nothing usable, so every " +
          "current-based conclusion — draw, internal resistance, " +
          "consumption — is honestly marked as needing a current " +
          "sensor instead of being estimated.",
        "An analyzer that fabricated a plausible-looking current " +
          "trace here would poison every downstream number. Absence " +
          "stated is trust earned.",
        "Voltage-side conclusions still stand: they come from a " +
          "sensor that actually reported."
      ],
      fix:
        "Check the current sensor wiring and its scale setting. " +
        "When real amps flow into the log, the missing sections " +
        "fill themselves in — nothing else about the flight needs " +
        "to change."
    }
  },
  {
    id: "stale-dump",
    file: "sample-academy-stale-dump.bbl",
    dumpFile: "sample-academy-stale-dump.dump.txt",
    title: "The dump that lied",
    teaser: "The saved settings and the flight disagree. Which do you believe?",
    brief:
      "This flight comes WITH its saved CLI dump — copy it from " +
      "this card and paste it into the model card (Add CLI " +
      "settings). Then watch what the app says about it. When you " +
      "understand who wins a disagreement, reveal the answer.",
    reveal: {
      diagnosis: [
        "Two settings in the pasted dump disagree with what this " +
          "log actually flew — the dump was saved before a bench " +
          "session and never refreshed. Dumps go stale silently.",
        "The app checks every mapped setting against the flown " +
          "headers of the log itself and flags the disagreement " +
          "instead of trusting the file.",
        "For any setting the log carries, the flown header value " +
          "wins — a stale dump can warn you, but it can never " +
          "mis-number a recommendation."
      ],
      fix:
        "Save a fresh dump after every bench session and update it " +
        "in the model card when the app asks. Once the app reads " +
        "your settings live from the flight controller, this check " +
        "happens by itself before anything is written."
    }
  }
];

export function academyEntryById(id) {
  return ACADEMY_ENTRIES.find((entry) => entry.id === id) ?? null;
}
