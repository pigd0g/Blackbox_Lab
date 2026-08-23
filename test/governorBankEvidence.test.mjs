// ======================================================
// TESTS — per-bank governor evidence is auditable (#35)
// ======================================================
//
// Every headspeed bank states how long it was flown and how far
// its numbers can be trusted; a lightly flown bank is shown as
// limited evidence and never ranked against a well-sampled one.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { bankEvidence, describeBank } from "../src/analysis/governorLabAnalysis.js";

test("bank evidence states duration and a confidence rung", () => {
  assert.deepEqual(bankEvidence(28_400, 200), {
    durationSeconds: 142,
    confidence: "High",
    limited: false
  });
  assert.deepEqual(bankEvidence(2_000, 200), {
    durationSeconds: 10,
    confidence: "Moderate",
    limited: false
  });
  assert.deepEqual(bankEvidence(260, 200), {
    durationSeconds: 1.3,
    confidence: "Low",
    limited: true
  });
});

test("a limited bank says so in words a report's recipient can act on", () => {
  const limited = describeBank({
    targetRpm: 2660,
    averageRpm: 2658,
    droopRpm: 12,
    droopPercent: 0.5,
    rmsError: 4.2,
    ...bankEvidence(260, 200)
  });
  assert.match(limited, /1\.3 s of evidence/);
  assert.match(limited, /Low confidence/);
  assert.match(limited, /limited evidence: not compared/);

  const solid = describeBank({
    targetRpm: 2480,
    averageRpm: 2487,
    droopRpm: 82,
    droopPercent: 3.3,
    rmsError: 9.1,
    ...bankEvidence(28_400, 200)
  });
  assert.match(solid, /142 s of evidence/);
  assert.match(solid, /High confidence/);
  assert.doesNotMatch(solid, /limited/);
});
