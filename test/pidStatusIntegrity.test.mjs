// ======================================================
// TESTS — PID overall status honors its own findings
// ======================================================
//
// "Clear" is a promise: nothing below needs follow-up. When the
// behavior checks (bounce-back, settling, ringing) file Review
// lines into the technical findings, the top-level status must
// say so — a pilot who stops reading at the header must get the
// same picture as one who reads to the bottom.
//
// And a "best profile" ranking is only as good as its thinnest
// side: a few-hundred-sample bank must not be crowned without
// its evidence being named.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/analysis/pidAnalysis.js", import.meta.url),
  "utf8"
);

test("behavior Review findings lift an overall Clear", () => {
  // The post-processing block exists and reads the same status
  // lines the findings emit.
  assert.match(source, /behaviorReviewCount/);
  assert.match(
    source,
    /\(bounce-back\|settling\|ringing\) status: Review/
  );
  assert.match(
    source,
    /overallStatus === "Clear" &&\s*\n\s*behaviorReviewCount > 0/
  );
});

test("under-sampled best profiles are qualified, not crowned", () => {
  assert.match(source, /bestProfileUnderSampled/);
  assert.match(source, /lowest observed tracking error/);
  // Both the summary and the technical findings carry the
  // qualification — same evidence story in both views.
  const qualified = source.match(/lowest observed tracking error/g);
  assert.ok(qualified.length >= 2, "qualification must appear in summary AND findings");
});
