// ======================================================
// INGEST PATHS — APP AND WORKER MUST AGREE
// ======================================================
//
// The app addresses contributions by content hash; the
// ingest worker stores them at the path it is given, after
// checking the shape. Those two live in different files and
// are deployed by different means, so nothing but a test
// keeps them speaking the same language. A path the app
// sends that the worker rejects is a contribution silently
// dropped in flight.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { contributionPaths } from "../src/contribute/uploader.js";

const here = dirname(fileURLToPath(import.meta.url));

const workerSource = readFileSync(
  join(here, "..", "src", "contribute", "ingest-worker.js"),
  "utf8"
);

// Read the pattern out of the worker itself rather than
// restating it here — a copy would drift.
function workerPathPattern() {
  const match = workerSource.match(
    /const CONTRIBUTION_PATH\s*=\s*\n?\s*(\/.*\/);/
  );

  assert.ok(
    match,
    "the worker must declare CONTRIBUTION_PATH for the app to be checked against"
  );

  const body = match[1];
  const lastSlash = body.lastIndexOf("/");

  return new RegExp(
    body.slice(1, lastSlash),
    body.slice(lastSlash + 1)
  );
}

const pattern = workerPathPattern();

// A real SHA-256 digest, as computeContentHash produces.
const HASH =
  "9f2c4a1b8e7d6c5a4b3e2d1c0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2109";

test("every path the app posts is a path the worker stores", () => {
  const paths = contributionPaths(HASH);

  for (const [part, path] of Object.entries(paths)) {
    assert.ok(
      pattern.test(path),
      `the worker would reject the ${part} path: ${path}`
    );
  }
});

test("the three parts of one contribution share one prefix", () => {
  const paths = contributionPaths(HASH);
  const prefixes = new Set(
    Object.values(paths).map((path) =>
      path.slice(0, path.lastIndexOf("/"))
    )
  );

  assert.equal(
    prefixes.size,
    1,
    "payload, frames and dump must be readable back as one contribution"
  );
});

test("the same flight always addresses the same place", () => {
  assert.deepEqual(
    contributionPaths(HASH),
    contributionPaths(HASH),
    "content-hash addressing is what makes a repeat upload idempotent"
  );

  const other = contributionPaths(HASH.replace(/^9/, "a"));
  assert.notDeepEqual(
    contributionPaths(HASH),
    other,
    "different flights must not collide"
  );
});

test("the worker accepts only the shape the app uses", () => {
  const rejected = [
    "contrib/1.1/" + HASH + "/../../escape.json",
    "contrib/1.1/" + HASH + "/anything-else.json",
    "contrib/1.1/NOT-A-HASH/payload.json",
    "contrib//" + HASH + "/payload.json",
    "elsewhere/" + HASH + "/payload.json",
    "contrib/1.1/" + HASH.toUpperCase() + "/payload.json",
    "",
    "payload.json"
  ];

  for (const path of rejected) {
    assert.equal(
      pattern.test(path),
      false,
      `the worker must not store an unrecognized path: ${path || "(empty)"}`
    );
  }
});

test("future schema versions still address cleanly", () => {
  for (const version of ["1", "1.1", "2", "2.0", "10.3"]) {
    assert.ok(
      pattern.test(`contrib/${version}/${HASH}/payload.json`),
      `schema ${version} must remain storable without a worker redeploy`
    );
  }
});

// ---- error reports travel the same worker ----

import {
  errorReportPath,
  buildErrorBundle,
  bundleFingerprint
} from "../src/errorReport.js";

function workerErrorPattern() {
  const match = workerSource.match(
    /const ERROR_REPORT_PATH\s*=\s*\n?\s*(\/.*\/);/
  );

  assert.ok(
    match,
    "the worker must declare ERROR_REPORT_PATH for the app to be checked against"
  );

  const body = match[1];
  const lastSlash = body.lastIndexOf("/");

  return new RegExp(
    body.slice(1, lastSlash),
    body.slice(lastSlash + 1)
  );
}

test("the error-report path the app sends is a path the worker accepts", () => {
  const bundle = buildErrorBundle({
    error: new Error("chart exploded"),
    platform: "test"
  });

  const path = errorReportPath(bundleFingerprint(bundle));

  assert.match(
    path,
    workerErrorPattern(),
    `worker would reject ${path}`
  );
});

test("the error route cannot carry a contribution-sized body", () => {
  const capMatch = workerSource.match(
    /MAX_ERROR_REPORT_BYTES\s*=\s*(\d+)\s*\*\s*1024/
  );

  assert.ok(capMatch, "the error route must declare its own size cap");
  assert.ok(
    Number(capMatch[1]) <= 256,
    "an error report is kilobytes, not a log"
  );
});
