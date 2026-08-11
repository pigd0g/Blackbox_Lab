// ======================================================
// TESTS — the error report describes software, not people
// ======================================================
//
// One dialog, one click. The bundle carries version,
// platform, error and mechanical file facts — bounded in
// size, deduplicated per failure, and never a byte of
// flight data.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildErrorBundle,
  bundleFingerprint,
  formatBundleText,
  alreadySent,
  markSent,
  errorReportPath
} from "../src/errorReport.js";

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  };
}

test("the bundle carries the facts and bounds them", () => {
  const bundle = buildErrorBundle({
    error: new Error("x".repeat(2000)),
    screen: "filter",
    lastAction: "opening huge.bbl",
    platform: "test",
    file: {
      name: "huge.bbl",
      sizeKb: 8600,
      frames: 134000,
      corruptFrames: 3,
      sampleRateHz: 998
    }
  });

  assert.equal(bundle.kind, "error-report");
  assert.equal(bundle.screen, "filter");
  assert.ok(bundle.message.length <= 500, "message is bounded");
  assert.ok(bundle.stack.length <= 4000, "stack is bounded");
  assert.equal(bundle.file.frames, 134000);
  assert.ok(bundle.app.length > 0, "app version travels");
});

test("same failure, same fingerprint — different failure, different one", () => {
  // Same creation site: the fingerprint keys on message + first
  // stack frame, so the same throw from the same place matches —
  // and the same message from a DIFFERENT place does not.
  const make = (message) => new Error(message);

  const first = buildErrorBundle({
    error: make("boom"),
    platform: "test"
  });
  const second = buildErrorBundle({
    error: make("boom"),
    platform: "test"
  });
  const other = buildErrorBundle({
    error: make("different boom"),
    platform: "test"
  });

  assert.equal(
    bundleFingerprint(first),
    bundleFingerprint(second)
  );
  assert.notEqual(
    bundleFingerprint(first),
    bundleFingerprint(other)
  );
  assert.match(
    errorReportPath(bundleFingerprint(first)),
    /^errors\/\d+\/[a-f0-9]{8,64}\.json$/
  );
});

test("one report per distinct failure per install", () => {
  const storage = memoryStorage();

  assert.equal(alreadySent(storage, "abcd1234"), false);
  markSent(storage, "abcd1234");
  assert.equal(alreadySent(storage, "abcd1234"), true);
  assert.equal(alreadySent(storage, "ffff0000"), false);
});

test("the clipboard text is readable and complete", () => {
  const bundle = buildErrorBundle({
    error: new Error("chart exploded"),
    screen: "pid",
    platform: "test",
    file: { name: "flight.bbl", sizeKb: 1200, frames: 90000 }
  });

  const text = formatBundleText(bundle);

  assert.match(text, /Blackbox Lab error report/);
  assert.match(text, /chart exploded/);
  assert.match(text, /flight\.bbl/);
  assert.match(text, /Screen: pid/);
});

test("benign browser noise never raises the dialog", async () => {
  const { isBenignBrowserNoise } = await import(
    "../src/errorReport.js"
  );

  assert.equal(
    isBenignBrowserNoise(
      "ResizeObserver loop completed with undelivered notifications."
    ),
    true
  );
  assert.equal(
    isBenignBrowserNoise(new Error("ResizeObserver loop limit exceeded")),
    true
  );
  assert.equal(
    isBenignBrowserNoise(new Error("chart exploded")),
    false
  );
});
