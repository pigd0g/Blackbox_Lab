// ======================================================
// BLACKBOX LAB — CONTRIBUTION UPLOAD LEDGER
//
// Remembers which content hashes this install has already
// contributed, so re-opening the same flight never uploads
// it twice. Local knowledge is enough for v1 — server-side
// dedup is the pipeline's job.
// ======================================================

const LEDGER_KEY = "blackboxLabContributedHashes";
const MAXIMUM_ENTRIES = 500;

function loadLedger(storage) {
  try {
    const raw = storage.getItem(LEDGER_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function hasContributed(storage, contentHash) {
  return loadLedger(storage).includes(contentHash);
}

export function recordContributed(storage, contentHash) {
  const entries = loadLedger(storage).filter(
    (entry) => entry !== contentHash
  );

  entries.push(contentHash);

  storage.setItem(
    LEDGER_KEY,
    JSON.stringify(entries.slice(-MAXIMUM_ENTRIES))
  );
}
