// ======================================================
// BLACKBOX LAB — LOG INGEST WORKER (Cloudflare)
//
// Paste-ready Cloudflare Worker: accepts contributed
// logs from the app and stores them in a private R2
// bucket. Setup guide: ingest-endpoint-setup.md
// ======================================================
//
// The app addresses each contribution by a hash of its own
// content, so the same flight always produces the same
// path. Storing an object at the path the app asks for is
// what makes that address mean something: a flight
// contributed twice lands on itself rather than beside
// itself, and the bucket holds one copy of each distinct
// flight however many times it arrives. It also keeps a
// contribution's three parts — payload, frames, dump —
// together under one prefix, so they can be read back as
// the one contribution they are.
//
// Paths are matched against a strict pattern rather than
// trusted, so the only writable shape is the one the app
// actually uses.

const MAX_BODY_BYTES = 40 * 1024 * 1024; // 40 MB gzipped

// contrib/<schema>/<content-hash>/<part>
//   schema: 1, 1.1, 2.0 …
//   hash:   hex, 16–128 chars
//   part:   payload.json | frames.bin.gz | dump.txt
const CONTRIBUTION_PATH =
  /^contrib\/\d+(?:\.\d+)?\/[a-f0-9]{16,128}\/(payload\.json|frames\.bin\.gz|dump\.txt)$/;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Blackbox Lab ingest", { status: 200 });
    }

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_BODY_BYTES) {
      return new Response("too large", { status: 413 });
    }

    const body = await request.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BODY_BYTES) {
      return new Response("bad body", { status: 400 });
    }

    const path = new URL(request.url).pathname.replace(/^\/+/, "");

    if (CONTRIBUTION_PATH.test(path)) {
      // Idempotent by construction: same flight, same key.
      await env.LOGS.put(path, body);
      return new Response("thanks", { status: 200 });
    }

    if (path === "") {
      // Releases that predate the addressed layout post a single
      // body to the root with nothing to key it by. They keep
      // working, in their own prefix, so the addressed area stays
      // clean.
      const id = crypto.randomUUID();
      const day = new Date().toISOString().slice(0, 10);
      const gzipped =
        request.headers.get("Content-Encoding") === "gzip" ? ".gz" : "";

      await env.LOGS.put(`legacy/${day}/${id}.json${gzipped}`, body);
      return new Response("thanks", { status: 200 });
    }

    return new Response("unrecognized path", { status: 400 });
  }
};
