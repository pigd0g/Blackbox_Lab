// ======================================================
// BLACKBOX LAB — PILOT INPUT (STICK) DISPLAY
// ======================================================
//
// What the pilot's hands did, drawn as two transmitter
// gimbals — an evidence layer for the moments the Labs
// talk about, and the base of the Replay screen and the
// video overlay to come.
//
// Functionality modeled on the Rotorflight Blackbox
// Explorer's stick view (GPL-3.0, Cleanflight/Betaflight/
// Rotorflight authors — thank you); implementation is
// Blackbox Lab's own: linear deflection mapping read from
// the log's actual ranges, app palette, no framework.
//
// Reads rcCommand[0..3] (roll, pitch, yaw, collective).
// A log without them simply has no pilot-input evidence —
// missing telemetry limits the conclusion, it never
// invents one.
//
// ======================================================

const STORAGE_KEY_MODE = "blackboxLabStickMode";

export const STICK_MODES = [1, 2, 3, 4];

export function getStickMode(storage = globalThis.localStorage) {
  const stored = Number(storage?.getItem?.(STORAGE_KEY_MODE));
  return STICK_MODES.includes(stored) ? stored : 2;
}

export function setStickMode(mode, storage = globalThis.localStorage) {
  if (STICK_MODES.includes(Number(mode))) {
    storage?.setItem?.(STORAGE_KEY_MODE, String(mode));
  }
}

// ------------------------------------------------------
// Data access
// ------------------------------------------------------

// The log states its own deflection range: RF logs use ±500 for
// roll/pitch/yaw and collective, but nothing is assumed — the
// observed extreme decides, with 500 as the floor so a calm
// flight is not stretched to full deflection.
function detectScale(values) {
  let maxAbs = 0;

  for (const value of values) {
    const abs = Math.abs(Number(value));
    if (Number.isFinite(abs) && abs > maxAbs) {
      maxAbs = abs;
    }
  }

  return Math.max(500, Math.ceil(maxAbs / 100) * 100);
}

/**
 * Bind the pilot-input columns of a dataset once.
 * Returns { available, frameAt(row), scales } — available is
 * false when the log carries no rcCommand telemetry.
 */
export function readPilotInput(dataset) {
  const columnFor = (index) => {
    const names = dataset.findColumnsIn([
      new RegExp(`^rcCommand\\[${index}\\]$`, "i")
    ]);
    return names.length > 0 ? dataset.columnValues(names[0]) : null;
  };

  const roll = columnFor(0);
  const pitch = columnFor(1);
  const yaw = columnFor(2);
  const collective = columnFor(3);

  if (!roll || !pitch || !yaw || !collective) {
    return { available: false };
  }

  const scales = {
    roll: detectScale(roll),
    pitch: detectScale(pitch),
    yaw: detectScale(yaw),
    collective: detectScale(collective)
  };

  return {
    available: true,
    scales,
    frameAt(row) {
      const index = Math.max(0, Math.min(roll.length - 1, row | 0));
      return {
        roll: Number(roll[index]) || 0,
        pitch: Number(pitch[index]) || 0,
        yaw: Number(yaw[index]) || 0,
        collective: Number(collective[index]) || 0
      };
    }
  };
}

/** Nearest row for a flight time, by binary search. */
export function timeToRowIndex(timeSeconds, t) {
  if (!Array.isArray(timeSeconds) || timeSeconds.length === 0) {
    return 0;
  }

  let low = 0;
  let high = timeSeconds.length - 1;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (timeSeconds[mid] < t) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

// ------------------------------------------------------
// Geometry — pure and testable
// ------------------------------------------------------

const clamp = (value) => Math.max(-1, Math.min(1, value));

/**
 * Normalized gimbal positions for a frame: x right, y up, both
 * in [-1, 1]. Transmitter mode decides which hand holds what;
 * mode 2 (throttle/collective left) is the default.
 */
export function mapStickPositions(frame, mode, scales) {
  const roll = clamp(frame.roll / scales.roll);
  const pitch = clamp(frame.pitch / scales.pitch);
  const yaw = clamp(frame.yaw / scales.yaw);
  const collective = clamp(frame.collective / scales.collective);

  // The label carries the live value, the way a pilot reads a
  // transmitter monitor: axis name + current deflection.
  const value = (name, raw) => `${name} ${Math.round(raw)}`;

  switch (Number(mode)) {
    case 1:
      return {
        left: { x: yaw, y: pitch },
        right: { x: roll, y: collective },
        labels: { left: [value("Yaw", frame.yaw), value("Pitch", frame.pitch)], right: [value("Roll", frame.roll), value("Col", frame.collective)] }
      };
    case 3:
      return {
        left: { x: roll, y: pitch },
        right: { x: yaw, y: collective },
        labels: { left: [value("Roll", frame.roll), value("Pitch", frame.pitch)], right: [value("Yaw", frame.yaw), value("Col", frame.collective)] }
      };
    case 4:
      return {
        left: { x: roll, y: collective },
        right: { x: yaw, y: pitch },
        labels: { left: [value("Roll", frame.roll), value("Col", frame.collective)], right: [value("Yaw", frame.yaw), value("Pitch", frame.pitch)] }
      };
    default:
      return {
        left: { x: yaw, y: collective },
        right: { x: roll, y: pitch },
        labels: { left: [value("Yaw", frame.yaw), value("Col", frame.collective)], right: [value("Roll", frame.roll), value("Pitch", frame.pitch)] }
      };
  }
}

// ------------------------------------------------------
// Drawing — app palette, canvas 2D
// ------------------------------------------------------

const COLORS = {
  box: "rgba(127, 183, 255, 0.07)",
  frame: "rgba(127, 183, 255, 0.22)",
  crosshair: "rgba(127, 183, 255, 0.28)",
  dot: "#ffc46b",
  trail: "255, 255, 255",
  label: "#b9c9e6"
};

function drawGimbal(ctx, cx, cy, radius, position, trail) {
  ctx.save();
  ctx.translate(cx, cy);

  const size = radius * 2;

  ctx.fillStyle = COLORS.box;
  ctx.strokeStyle = COLORS.frame;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-radius, -radius, size, size, 8);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = COLORS.crosshair;
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.stroke();

  if (Array.isArray(trail)) {
    trail.forEach((point, index) => {
      ctx.beginPath();
      ctx.fillStyle = `rgba(${COLORS.trail}, ${(index / trail.length) * 0.28})`;
      ctx.arc(
        point.x * radius,
        -point.y * radius,
        Math.max(1.5, radius / 16),
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  }

  ctx.beginPath();
  ctx.fillStyle = COLORS.dot;
  ctx.arc(
    position.x * radius,
    -position.y * radius,
    Math.max(3, radius / 7),
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.restore();
}

export function drawStickFrame(canvas, positions, options = {}) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);

  const labelSpace = options.labels === false ? 0 : 14;
  const spacing = Math.min(width / 12, height / 10, 14);
  const radius = Math.min(
    width / 4 - spacing,
    (height - labelSpace) / 2 - spacing / 2
  );

  const centerY = (height - labelSpace) / 2 + 2;
  const leftX = width / 2 - spacing / 2 - radius;
  const rightX = width / 2 + spacing / 2 + radius;

  drawGimbal(
    ctx,
    leftX,
    centerY,
    radius,
    positions.left,
    options.leftTrail
  );
  drawGimbal(
    ctx,
    rightX,
    centerY,
    radius,
    positions.right,
    options.rightTrail
  );

  if (options.labels !== false && positions.labels) {
    ctx.fillStyle = COLORS.label;
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      positions.labels.left.join(" · "),
      leftX,
      height - 3
    );
    ctx.fillText(
      positions.labels.right.join(" · "),
      rightX,
      height - 3
    );
  }

  canvas.dataset.stickRendered = "1";
}

// ------------------------------------------------------
// Controller — one canvas bound to one flight
// ------------------------------------------------------

const TRAIL_SECONDS = 0.5;
const TRAIL_POINTS = 24;

/**
 * Binds a canvas to a dataset's pilot input.
 * Returns null when the log has no rcCommand telemetry.
 */
export function createStickDisplay(canvas, { dataset, pilotInput }) {
  const input = pilotInput ?? readPilotInput(dataset);

  if (!input.available) {
    return null;
  }

  const timeSeconds = dataset.timeSeconds;
  let animationHandle = null;

  function positionsAt(t) {
    const row = timeToRowIndex(timeSeconds, t);
    return mapStickPositions(
      input.frameAt(row),
      getStickMode(),
      input.scales
    );
  }

  function trailsAt(t) {
    const leftTrail = [];
    const rightTrail = [];

    for (let i = 0; i < TRAIL_POINTS; i += 1) {
      const trailTime =
        t - TRAIL_SECONDS + (i / TRAIL_POINTS) * TRAIL_SECONDS;

      if (trailTime < timeSeconds[0]) {
        continue;
      }

      const positions = positionsAt(trailTime);
      leftTrail.push(positions.left);
      rightTrail.push(positions.right);
    }

    return { leftTrail, rightTrail };
  }

  function showTime(t, { withTrail = true } = {}) {
    const positions = positionsAt(t);
    const trails = withTrail
      ? trailsAt(t)
      : { leftTrail: null, rightTrail: null };

    drawStickFrame(canvas, positions, {
      leftTrail: trails.leftTrail,
      rightTrail: trails.rightTrail
    });
  }

  function stop() {
    if (animationHandle !== null) {
      cancelAnimationFrame(animationHandle);
      animationHandle = null;
    }
  }

  // Play the window once at true speed, then rest at restTime
  // (default: the end of the window).
  function playWindow(minT, maxT, { restTime = null } = {}) {
    stop();

    let startedAt = null;

    const step = (now) => {
      if (startedAt === null) {
        startedAt = now;
      }

      const t = minT + (now - startedAt) / 1000;

      if (t >= maxT) {
        showTime(restTime ?? maxT);
        animationHandle = null;
        return;
      }

      showTime(t);
      animationHandle = requestAnimationFrame(step);
    };

    animationHandle = requestAnimationFrame(step);
  }

  return { showTime, playWindow, stop };
}
