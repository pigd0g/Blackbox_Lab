// ======================================================
// BLACKBOX LAB — ERROR REPORT
// ======================================================
//
// When something breaks, the pilot should never be the
// one doing the debugging. One dialog, one click: the
// technical details travel to the project, the pilot
// flies on. The report describes the SOFTWARE — version,
// platform, error, what screen was active, mechanical
// facts about the file — never flight data, never a dump,
// never anything about the person.
//
// Clicking "Send report" is the consent; the dialog says
// in one line what the report contains. Copy-to-clipboard
// stays as the offline path.
//
// ======================================================

import { APP_VERSION } from "./version.js";
import { uploadContribution } from "./contribute/uploader.js";

export const ERROR_REPORT_SCHEMA = 1;

// Trimmed hard: a report is a pointer to a bug, not a core dump.
const MAXIMUM_MESSAGE_LENGTH = 500;
const MAXIMUM_STACK_LENGTH = 4000;

const trim = (text, maximumLength) =>
  String(text ?? "").slice(0, maximumLength);

export function buildErrorBundle({
  error,
  screen = null,
  lastAction = null,
  file = null,
  platform = typeof navigator !== "undefined"
    ? navigator.platform
    : process.platform
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (error?.message ?? String(error));

  return {
    kind: "error-report",
    schema: ERROR_REPORT_SCHEMA,
    app: APP_VERSION,
    platform: String(platform ?? "unknown"),
    at: new Date().toISOString(),
    screen,
    lastAction,
    message: trim(message, MAXIMUM_MESSAGE_LENGTH),
    stack: trim(error?.stack ?? "", MAXIMUM_STACK_LENGTH),
    // Mechanical facts only — enough to reproduce the shape of the
    // input without carrying any of its content.
    file: file
      ? {
          name: String(file.name ?? ""),
          sizeKb: file.sizeKb ?? null,
          frames: file.frames ?? null,
          corruptFrames: file.corruptFrames ?? null,
          sampleRateHz: file.sampleRateHz ?? null,
          fieldCount: file.fieldCount ?? null
        }
      : null
  };
}

// One line of identity per distinct failure: version + message +
// the first meaningful stack frame. Same bug, same fingerprint —
// on this install and across the fleet.
export function bundleFingerprint(bundle) {
  const firstFrame =
    String(bundle.stack ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("at ")) ?? "";

  const identity = `${bundle.app}|${bundle.message}|${firstFrame}`;

  let hash = 5381;

  for (let i = 0; i < identity.length; i += 1) {
    hash = ((hash << 5) + hash + identity.charCodeAt(i)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

export function formatBundleText(bundle) {
  const lines = [
    `Blackbox Lab error report`,
    `App: v${bundle.app} on ${bundle.platform}`,
    `When: ${bundle.at}`,
    `Screen: ${bundle.screen ?? "unknown"}${
      bundle.lastAction ? ` (last action: ${bundle.lastAction})` : ""
    }`,
    `Error: ${bundle.message}`
  ];

  if (bundle.file) {
    const file = bundle.file;
    lines.push(
      `File: ${file.name} (${file.sizeKb ?? "?"} kB, ` +
        `${file.frames ?? "?"} frames` +
        `${file.corruptFrames ? `, ${file.corruptFrames} corrupt` : ""}` +
        `${file.sampleRateHz ? `, ~${Math.round(file.sampleRateHz)} Hz` : ""})`
    );
  }

  if (bundle.stack) {
    lines.push("", bundle.stack);
  }

  return lines.join("\n");
}

// ------------------------------------------------------
// Send-once bookkeeping — a crashing loop must not flood
// the bucket. One report per distinct failure per install.
// ------------------------------------------------------

const SENT_KEY = "blackboxLabErrorReportsSent";
const MAXIMUM_REMEMBERED = 100;

function loadSent(storage) {
  try {
    const raw = storage.getItem(SENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function alreadySent(storage, fingerprint) {
  return loadSent(storage).includes(fingerprint);
}

export function markSent(storage, fingerprint) {
  const sent = loadSent(storage).filter(
    (entry) => entry !== fingerprint
  );

  sent.push(fingerprint);

  storage.setItem(
    SENT_KEY,
    JSON.stringify(sent.slice(-MAXIMUM_REMEMBERED))
  );
}

// ------------------------------------------------------
// Transport — the community ingest worker, errors/ path.
// Same fire-and-forget contract as contributions: a
// failure to send never becomes the pilot's problem.
// ------------------------------------------------------

export function errorReportPath(fingerprint) {
  return `errors/${ERROR_REPORT_SCHEMA}/${fingerprint}.json`;
}

export async function sendErrorReport(endpoint, bundle) {
  if (!endpoint) {
    return { ok: false, status: 0 };
  }

  const url = `${String(endpoint).replace(/\/+$/, "")}/${errorReportPath(
    bundleFingerprint(bundle)
  )}`;

  try {
    return await uploadContribution(url, bundle);
  } catch {
    return { ok: false, status: 0 };
  }
}

// ------------------------------------------------------
// Capture — the global net under everything else.
// ------------------------------------------------------

// Browser noise that is not an application failure. Chromium
// emits the ResizeObserver line whenever a resize callback
// triggers layout in the same frame — our chart observers do,
// harmlessly and by design. A dialog for it would greet every
// pilot on their first verdict click.
const BENIGN_MESSAGES = [
  /ResizeObserver loop completed with undelivered notifications/i,
  /ResizeObserver loop limit exceeded/i
];

export function isBenignBrowserNoise(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error?.message ?? error ?? "");

  return BENIGN_MESSAGES.some((pattern) => pattern.test(message));
}

// The same failure can fire error + unhandledrejection in quick
// succession; one dialog is enough.
const REPEAT_WINDOW_MS = 5000;

export function installErrorCapture({ onError }) {
  let lastFingerprint = null;
  let lastShownAt = 0;

  const handle = (error) => {
    try {
      if (isBenignBrowserNoise(error)) {
        return;
      }

      const bundle = buildErrorBundle({ error });
      const fingerprint = bundleFingerprint(bundle);
      const now = Date.now();

      if (
        fingerprint === lastFingerprint &&
        now - lastShownAt < REPEAT_WINDOW_MS
      ) {
        return;
      }

      lastFingerprint = fingerprint;
      lastShownAt = now;
      onError(error);
    } catch {
      // The error handler must never become an error source.
    }
  };

  window.addEventListener("error", (event) => {
    handle(event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    handle(event.reason);
  });
}
