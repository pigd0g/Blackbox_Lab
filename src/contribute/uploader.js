// ======================================================
// BLACKBOX LAB — CONTRIBUTION UPLOADER
//
// Gzips the anonymized payload and POSTs it to the
// community ingest endpoint. Fire-and-forget: failures
// never interrupt the pilot, they just log to console.
// ======================================================

async function gzipJson(payload) {
  const json = JSON.stringify(payload);

  if (typeof CompressionStream === "undefined") {
    return { body: json, encoding: null };
  }

  const stream = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const body = await new Response(stream).blob();

  return { body, encoding: "gzip" };
}

export async function uploadContribution(endpoint, payload) {
  const { body, encoding } = await gzipJson(payload);

  const headers = { "Content-Type": "application/json" };
  if (encoding) {
    headers["Content-Encoding"] = encoding;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body
  });

  return { ok: response.ok, status: response.status };
}

// ------------------------------------------------------
// Schema v1 layout — one object per concern, addressed by
// content hash. Same transport as ever (gzipped POST to
// the ingest endpoint); only the paths are new.
//
// frames arrive gzip-compressed (frames.bin.gz): zstd
// would need a new dependency, which this package does
// not introduce.
// ------------------------------------------------------

import { CONTRIBUTION_SCHEMA_VERSION } from "./contributionBuilder.js";

export function contributionPaths(contentHash) {
  const base = `contrib/${CONTRIBUTION_SCHEMA_VERSION}/${contentHash}`;

  return {
    payload: `${base}/payload.json`,
    frames: `${base}/frames.bin.gz`,
    dump: `${base}/dump.txt`
  };
}

function joinUrl(endpoint, path) {
  return `${String(endpoint).replace(/\/+$/, "")}/${path}`;
}

async function postPart(url, body, headers) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body
  });

  return { ok: response.ok, status: response.status };
}

/**
 * Upload one Schema v1 contribution as its three objects.
 * `dumpText` may be null (no dump consent / nothing
 * pasted) — then only payload and frames travel.
 *
 * Returns { ok, status } of the least successful part, so
 * a partial failure never reads as success.
 */
export async function uploadContributionV1(
  endpoint,
  { contentHash, payload, frames, dumpText }
) {
  const paths = contributionPaths(contentHash);
  const results = [];

  const payloadBody = await gzipJson(payload);
  results.push(
    await postPart(joinUrl(endpoint, paths.payload), payloadBody.body, {
      "Content-Type": "application/json",
      ...(payloadBody.encoding
        ? { "Content-Encoding": payloadBody.encoding }
        : {})
    })
  );

  const framesBody = await gzipJson(frames);
  results.push(
    await postPart(joinUrl(endpoint, paths.frames), framesBody.body, {
      "Content-Type": "application/octet-stream",
      ...(framesBody.encoding
        ? { "Content-Encoding": framesBody.encoding }
        : {})
    })
  );

  if (dumpText != null) {
    results.push(
      await postPart(joinUrl(endpoint, paths.dump), dumpText, {
        "Content-Type": "text/plain"
      })
    );
  }

  const failed = results.find((result) => !result.ok);
  return failed ?? results[0];
}
