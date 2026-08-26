// ======================================================
// BLACKBOX LAB — CHARTS
// ======================================================
//
// Thin wrappers around uPlot (vendored, MIT) so every Lab
// can show a chart with one call. Charts are the teaching
// layer: show the pilot the story, then explain it.
//
//   renderTimeSeriesChart(element, {
//     timeSeconds, series: [{ label, values, color }]
//   });
//
//   renderSpectrumChart(element, spectrum, { label });
//
// ======================================================

import uPlot from "../vendor/uplot/uPlot.esm.js";
import { VIBRATION_FLOOR_HZ } from "../analysis/dsp/fft.js";

// Colorblind-safe series palette tuned for dark surfaces.
export const CHART_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // green-aqua
  "#c98500", // amber
  "#d55181", // magenta
  "#9085e9" // violet
];

const AXIS_STYLE = {
  stroke: "#8ea6cc",
  grid: { stroke: "rgba(127, 183, 255, 0.08)", width: 1 },
  ticks: { stroke: "rgba(127, 183, 255, 0.18)", width: 1 },
  // uPlot's default is a small 12px — the axes are where the
  // reading actually happens, so they follow the app's type
  // scale.
  font: "13.5px 'Segoe UI', system-ui, sans-serif",
  labelFont: "14px 'Segoe UI', system-ui, sans-serif"
};

function destroyExistingChart(element) {
  if (element.__blackboxLabChart) {
    const group = element.__blackboxLabLinkGroup
      ? linkGroups.get(element.__blackboxLabLinkGroup)
      : null;

    if (group) {
      group.delete(element.__blackboxLabChart);
      element.__blackboxLabLinkGroup = null;
    }

    const seriesGroup = element.__blackboxLabSeriesSyncGroup
      ? seriesSyncGroups.get(element.__blackboxLabSeriesSyncGroup)
      : null;

    if (seriesGroup) {
      seriesGroup.delete(element.__blackboxLabChart);
      element.__blackboxLabSeriesSyncGroup = null;
    }

    element.__blackboxLabChart.destroy();
    element.__blackboxLabChart = null;
  }

  element.innerHTML = "";
}

function watchResize(element, chart) {
  if (element.__blackboxLabResizeObserver) {
    element.__blackboxLabResizeObserver.disconnect();
  }

  const observer = new ResizeObserver(() => {
    // A hidden screen reports width 0 — resizing to that
    // would wipe the chart's pixels (and empty the images
    // embedded in HTML reports). Keep the last real size.
    if (element.clientWidth > 0) {
      chart.setSize({
        width: element.clientWidth,
        height: chart.height
      });
    }
  });

  observer.observe(element);
  element.__blackboxLabResizeObserver = observer;
}

// ------------------------------------------------------
// Time series (x axis in seconds of flight time)
// ------------------------------------------------------
// Raw log columns are numbered, not named — translate the
// number into the axis a pilot thinks in. RF axis order:
// 0 = Roll, 1 = Pitch, 2 = Yaw, 3 = Collective.
const AXIS_NAMES = ["Roll", "Pitch", "Yaw", "Collective"];

export function friendlySeriesLabel(name) {
  const match = String(name).match(/^([A-Za-z]+)\[(\d)\]$/);
  if (!match) return name;

  const base = match[1];
  const index = Number(match[2]);

  // Servos are wired by position, not by axis: cyclics on S1-S3,
  // tail on S4 (Rotorflight convention).
  if (/^servo$/i.test(base)) {
    if (index <= 2) return `Cyclic servo ${index + 1}`;
    if (index === 3) return "Tail servo";
    return `Servo ${index + 1}`;
  }

  if (/^motor$/i.test(base)) {
    return `Motor ${index + 1} output`;
  }

  const axis = AXIS_NAMES[index];
  if (!axis) return name;
  if (/^gyroADC$/i.test(base)) return `${axis} gyro (filtered)`;
  if (/^(gyroRAW|gyroUnfilt)$/i.test(base)) return `${axis} gyro (raw)`;
  if (/^setpoint$/i.test(base)) return `${axis} target`;
  if (/^axis([PIDF])$/i.test(base)) {
    return `${axis} ${base.slice(-1).toUpperCase()}-term`;
  }
  if (/^rcCommand$/i.test(base)) return `${axis} stick`;
  return name;
}

// Whole-name aliases are kept in ONE wording with the Replay field
// catalog (src/ui/replayFields.js) — a field must never wear two
// different names on two pages (#63).
const WHOLE_NAME_LABELS = {
  headspeed: "Headspeed",
  govTarget: "Governor target",
  governorTarget: "Governor target",
  vbatLatest: "Pack voltage",
  Vbat: "Pack voltage",
  Ibat: "Pack current",
  govP: "Governor P",
  govI: "Governor I",
  govD: "Governor D",
  govF: "Governor feedforward",
  govSum: "Governor sum",
  EscV: "ESC voltage",
  EscI: "ESC current",
  EscThr: "ESC throttle",
  EscRPM: "ESC motor RPM",
  EscCap: "ESC consumed capacity",
  EscPwm: "ESC PWM",
  Tesc: "ESC temperature",
  Tesc2: "ESC 2 temperature",
  Tmcu: "MCU temperature",
  rssi: "Link strength (RSSI)",
  Vbec: "BEC voltage",
  BecV: "BEC voltage (ESC-reported)",
  BecI: "BEC current"
};

export function friendlyLabel(name) {
  return WHOLE_NAME_LABELS[name] ?? friendlySeriesLabel(name);
}

// Min/max of each visible series, recomputed on every zoom.
function computeVisibleStats(u, seriesMeta) {
  const xs = u.data[0];
  const xMin = u.scales.x.min;
  const xMax = u.scales.x.max;
  const stats = [];

  for (let s = 0; s < seriesMeta.length && s < 3; s += 1) {
    const ys = u.data[s + 1];
    let min = Infinity;
    let max = -Infinity;
    let minX = null;
    let maxX = null;

    for (let i = 0; i < xs.length; i += 1) {
      if (xs[i] < xMin || xs[i] > xMax) continue;
      const value = ys[i];
      if (value == null) continue;
      if (value < min) { min = value; minX = xs[i]; }
      if (value > max) { max = value; maxX = xs[i]; }
    }

    if (minX !== null) {
      stats.push({
        label: seriesMeta[s].label,
        color: seriesMeta[s].color,
        min, minX, max, maxX
      });
    }
  }

  return stats;
}

const fmt = (value) =>
  Math.abs(value) >= 100
    ? String(Math.round(value))
    : String(Math.round(value * 10) / 10);

function buildChartFooter(element, chart, seriesMeta, { withStats, formatX }) {
  // Extrema positions are labeled by the x-axis's own unit: seconds
  // for flight time, "Flight N" for history trends — never "2.0s"
  // for what is actually the second logged flight.
  const xText = formatX ?? ((value) => `${value.toFixed(1)}s`);
  const footer = document.createElement("div");
  footer.className = "chart-footer";

  const stats = document.createElement("div");
  stats.className = "chart-stats";
  footer.appendChild(stats);

  const hint = document.createElement("div");
  hint.className = "chart-footer-hint";
  hint.textContent = "drag to zoom · double-click to reset";
  footer.appendChild(hint);

  element.appendChild(footer);

  if (!withStats) return;

  const refresh = () => {
    const visible = computeVisibleStats(chart, seriesMeta);
    stats.innerHTML = visible
      .map(
        (entry) =>
          `<span class="chart-stat"><i style="background:${entry.color}"></i>` +
          `${entry.label}: ` +
          `<b>▾ ${fmt(entry.min)}</b> @ ${xText(entry.minX)} · ` +
          `<b>▴ ${fmt(entry.max)}</b> @ ${xText(entry.maxX)}</span>`
      )
      .join("");
  };

  // uPlot only creates hook arrays declared in its options —
  // make sure the slot exists before subscribing.
  chart.hooks.setScale = chart.hooks.setScale || [];
  chart.hooks.setScale.push((u, key) => {
    if (key === "x") refresh();
  });
  refresh();
}

// Charts in the same link group share their x-axis window:
// zooming one zooms the others. Used by the synchronized
// evidence views (worst droop, highest load).
const linkGroups = new Map();
let broadcastingLinkGroup = false;

function joinLinkGroup(groupName, chart, element) {
  if (!linkGroups.has(groupName)) {
    linkGroups.set(groupName, new Set());
  }

  const group = linkGroups.get(groupName);
  group.add(chart);
  element.__blackboxLabLinkGroup = groupName;

  chart.hooks.setScale = chart.hooks.setScale || [];
  chart.hooks.setScale.push((u, key) => {
    if (key !== "x" || broadcastingLinkGroup) {
      return;
    }

    broadcastingLinkGroup = true;

    try {
      for (const sibling of group) {
        if (sibling !== u) {
          sibling.setScale("x", {
            min: u.scales.x.min,
            max: u.scales.x.max
          });
        }
      }
    } finally {
      broadcastingLinkGroup = false;
    }
  });
}

// Charts in the same series-sync group share legend toggles:
// hiding a flight in one axis hides it in the others too.
// Series are matched by label, not index, because the axes
// can have different flight counts.
const seriesSyncGroups = new Map();
let broadcastingSeriesSync = false;

function joinSeriesSyncGroup(groupName, chart, element) {
  if (!seriesSyncGroups.has(groupName)) {
    seriesSyncGroups.set(groupName, new Set());
  }

  const group = seriesSyncGroups.get(groupName);
  group.add(chart);
  element.__blackboxLabSeriesSyncGroup = groupName;

  chart.hooks.setSeries = chart.hooks.setSeries || [];
  chart.hooks.setSeries.push((u, seriesIdx, opts) => {
    if (broadcastingSeriesSync || seriesIdx <= 0 || opts.show == null) {
      return;
    }

    const label = u.series[seriesIdx]?.label;
    if (!label) {
      return;
    }

    broadcastingSeriesSync = true;

    try {
      for (const sibling of group) {
        if (sibling === u) {
          continue;
        }

        const match = sibling.series.findIndex(
          (s, i) => i > 0 && s.label === label
        );

        if (match >= 0) {
          sibling.setSeries(match, { show: opts.show }, true, false);
        }
      }
    } finally {
      broadcastingSeriesSync = false;
    }
  });
}

// ------------------------------------------------------
// Step response chart (time axis in milliseconds)
//
// Accepts either a single response (legacy shape):
//   { timeMs, response, metrics }
// or a list of per-flight series plus an optional average:
//   { series: [{ label, timeMs, response, metrics, color }], average: { response, metrics } }
// ------------------------------------------------------
export function renderStepResponseChart(element, options = {}) {
  destroyExistingChart(element);

  const height = options.height ?? 260;
  const seriesList = Array.isArray(options.series) && options.series.length > 0
    ? options.series
    : [
        {
          label: "Step response",
          timeMs: options.timeMs,
          response: options.response,
          metrics: options.metrics,
          color: CHART_COLORS[0]
        }
      ];

  const average = options.average || null;

  // Common time grid: every series shares the first one's x values.
  const timeMs = seriesList[0].timeMs;

  // Build the uPlot data: [x, avg?, s1, s2, ...].
  const data = [Float64Array.from(timeMs)];
  if (average && Array.isArray(average.response)) {
    data.push(Float64Array.from(average.response));
  }
  for (const s of seriesList) {
    data.push(Float64Array.from(s.response));
  }

  // Y axis max across every visible curve and overshoot lines.
  let yMax = 1.15;
  const allResponses = [];
  if (average && Array.isArray(average.response)) allResponses.push(average.response);
  for (const s of seriesList) allResponses.push(s.response);
  for (const resp of allResponses) {
    for (let i = 0; i < resp.length; i += 1) {
      if (Number.isFinite(resp[i]) && resp[i] + 0.05 > yMax) yMax = resp[i] + 0.05;
    }
  }
  for (const s of seriesList) {
    if (s.metrics && s.metrics.maxOvershoot) {
      const o = 1 + s.metrics.maxOvershoot;
      if (o > yMax) yMax = o;
    }
  }
  if (average && average.metrics && average.metrics.maxOvershoot) {
    const o = 1 + average.metrics.maxOvershoot;
    if (o > yMax) yMax = o;
  }

  // Markers: rise-time lines for the average (preferred) or first series.
  const markerSource = average?.metrics || seriesList[0].metrics;
  const markers = [];
  if (markerSource && Number.isFinite(markerSource.riseTimeMs) && markerSource.riseTimeMs > 0) {
    markers.push({ x: markerSource.riseTimeMs, label: `rise ${markerSource.riseTimeMs.toFixed(0)} ms` });
  }

  const overshootY = markerSource?.maxOvershoot ? 1 + markerSource.maxOvershoot : null;

  // uPlot series definitions (x first, then optional average, then flights).
  const uplotSeries = [
    {
      label: "ms",
      value: (self, value) =>
        value == null ? "--" : value.toFixed(0)
    }
  ];

  const footerMeta = [];

  if (average && Array.isArray(average.response)) {
    uplotSeries.push({
      label: "Average",
      stroke: "rgba(127, 183, 255, 0.85)",
      width: 2.4,
      dash: [6, 4],
      points: { show: false },
      value: (self, value) =>
        value == null ? "--" : value.toFixed(2)
    });
    footerMeta.push({ label: "Average", color: "rgba(127, 183, 255, 0.85)" });
  }

  seriesList.forEach((s, index) => {
    const color = s.color || CHART_COLORS[index % CHART_COLORS.length];
    uplotSeries.push({
      label: s.label,
      stroke: color,
      width: 1.6,
      points: { show: false },
      value: (self, value) =>
        value == null ? "--" : value.toFixed(2)
    });
    footerMeta.push({ label: s.label, color });
  });

  const chart = new uPlot(
    {
      width: element.clientWidth || 640,
      height,
      padding: [12, 8, 0, 0],
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: false },
        y: { range: [0, yMax] }
      },
      axes: [
        {
          ...AXIS_STYLE,
          label: "Time (ms)",
          labelSize: 22
        },
        {
          ...AXIS_STYLE,
          label: "Response",
          labelSize: 22,
          size: 62
        }
      ],
      series: uplotSeries,
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            ctx.save();

            // y = 0 reference
            ctx.strokeStyle = "rgba(127, 183, 255, 0.25)";
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            const y0 = u.valToPos(0, "y", true);
            ctx.moveTo(u.bbox.left, y0);
            ctx.lineTo(u.bbox.left + u.bbox.width, y0);
            ctx.stroke();

            // y = 1 target
            ctx.strokeStyle = "rgba(127, 183, 255, 0.5)";
            ctx.beginPath();
            const y1 = u.valToPos(1, "y", true);
            ctx.moveTo(u.bbox.left, y1);
            ctx.lineTo(u.bbox.left + u.bbox.width, y1);
            ctx.stroke();

            // Overshoot line
            if (overshootY != null && markerSource.maxOvershoot >= 0.01) {
              ctx.strokeStyle = "rgba(255, 157, 92, 0.7)";
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              const yOver = u.valToPos(overshootY, "y", true);
              ctx.moveTo(u.bbox.left, yOver);
              ctx.lineTo(u.bbox.left + u.bbox.width, yOver);
              ctx.stroke();
            }

            ctx.restore();
          },
          (u) => {
            if (!markers.length) return;
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
            ctx.fillStyle = "#dce8ff";
            ctx.setLineDash([4, 4]);
            ctx.font = "13px sans-serif";
            ctx.textAlign = "center";

            for (const marker of markers) {
              const x = u.valToPos(marker.x, "x", true);
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.fillText(marker.label, x, u.bbox.top + 14);
            }

            ctx.restore();
          }
        ]
      }
    },
    data,
    element
  );

  element.__blackboxLabChart = chart;
  watchResize(element, chart);
  buildChartFooter(element, chart, footerMeta, { withStats: true });
  joinSeriesSyncGroup("stepResponse", chart, element);

  return chart;
}

export function renderTimeSeriesChart(element, options) {
  const {
    timeSeconds,
    series,
    height = 260,
    yLabel = "",
    xLabel = "Flight time (s)",
    markers = [],
    bands = [],
    linkGroup = null,
    formatX = null,
    initialWindow = null
  } = options;

  destroyExistingChart(element);

  const data = [
    Float64Array.from(timeSeconds),
    ...series.map((entry) => Float64Array.from(entry.values))
  ];

  const seriesMeta = series.map((entry, index) => ({
    // A series that states its label exactly keeps it: the Replay
    // field charts must not have a friendly-label layer guess a
    // servo's function back into the legend (#63).
    label: entry.exactLabel ? entry.label : friendlyLabel(entry.label),
    color: entry.color ?? CHART_COLORS[index % CHART_COLORS.length]
  }));

  const chart = new uPlot(
    {
      width: element.clientWidth || 640,
      height,
      padding: [12, 8, 0, 0],
      cursor: {
        drag: { x: true, y: false },
        points: { size: 7 }
      },
      hooks: {
        draw: [
          // Shaded x-ranges behind the traces: the stretch of
          // time a measurement was taken from, so a marker is
          // never read without the window it belongs to.
          (u) => {
            if (!bands.length) {
              return;
            }

            const ctx = u.ctx;
            ctx.save();
            ctx.font = "12px sans-serif";
            ctx.textAlign = "left";

            for (const band of bands) {
              const left = Math.max(
                u.valToPos(band.min, "x", true),
                u.bbox.left
              );
              const right = Math.min(
                u.valToPos(band.max, "x", true),
                u.bbox.left + u.bbox.width
              );
              if (!(right > left)) continue;
              ctx.fillStyle = band.color ?? "rgba(120, 170, 255, 0.10)";
              ctx.fillRect(left, u.bbox.top, right - left, u.bbox.height);
              if (band.label) {
                ctx.fillStyle = "rgba(220, 232, 255, 0.75)";
                ctx.fillText(
                  band.label,
                  left + 4,
                  u.bbox.top + u.bbox.height - 6
                );
              }
            }

            ctx.restore();
          },
          // Small dots on each visible series' min and max —
          // they move with the zoom window.
          (u) => {
            const ctx = u.ctx;
            ctx.save();
            for (const entry of computeVisibleStats(u, seriesMeta)) {
              for (const point of [
                [entry.minX, entry.min],
                [entry.maxX, entry.max]
              ]) {
                const x = u.valToPos(point[0], "x", true);
                const y = u.valToPos(point[1], "y", true);
                ctx.beginPath();
                ctx.arc(x, y, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = entry.color;
                ctx.fill();
                ctx.strokeStyle = "rgba(7, 11, 18, 0.9)";
                ctx.lineWidth = 1.5;
                ctx.stroke();
              }
            }
            ctx.restore();
          },
          (u) => {
            if (!markers.length) {
              return;
            }

            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
            ctx.fillStyle = "#dce8ff";
            ctx.setLineDash([4, 4]);
            ctx.font = "13px sans-serif";
            ctx.textAlign = "center";

            for (const marker of markers) {
              const x = u.valToPos(marker.x, "x", true);

              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) {
                continue;
              }

              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.fillText(marker.label, x, u.bbox.top + 14);
            }

            ctx.restore();
          }
        ]
      },
      scales: {
        x: { time: false }
      },
      axes: [
        {
          ...AXIS_STYLE,
          label: xLabel,
          labelSize: 22
        },
        {
          ...AXIS_STYLE,
          label: yLabel,
          labelSize: yLabel ? 22 : 8,
          size: 62
        }
      ],
      series: [
        {
          label: xLabel === "Flight time (s)" ? "t (s)" : xLabel,
          value: (self, value) =>
            value == null ? "--" : value.toFixed(2)
        },
        ...series.map((entry, index) => ({
          label: entry.exactLabel ? entry.label : friendlyLabel(entry.label),
          stroke: entry.color ?? CHART_COLORS[index % CHART_COLORS.length],
          width: 1.4,
          // pointsOnly: single measurements shown as dots with NO
          // connecting line — two flights are two facts, not a trend
          // (#65). The connecting stroke is what implies causality.
          ...(entry.pointsOnly
            ? { paths: () => null, points: { show: true, size: 8 } }
            : { points: { show: false } }),
          value: (self, value) =>
            value == null ? "--" : String(Math.round(value * 100) / 100)
        }))
      ]
    },
    data,
    element
  );

  // The initial x-window is applied HERE, on the chart just built —
  // never by a caller through a stored handle that can go stale and
  // fail silently, leaving a full-flight view under an event card
  // that names one moment (#71).
  if (
    initialWindow &&
    Number.isFinite(initialWindow.min) &&
    Number.isFinite(initialWindow.max) &&
    initialWindow.max > initialWindow.min
  ) {
    chart.setScale("x", { min: initialWindow.min, max: initialWindow.max });
  }
  element.__blackboxLabChart = chart;
  watchResize(element, chart);
  buildChartFooter(element, chart, seriesMeta, { withStats: true, formatX });

  if (linkGroup) {
    joinLinkGroup(linkGroup, chart, element);
  }

  return chart;
}

// ------------------------------------------------------
// Noise spectrum (frequency domain)
// ------------------------------------------------------
export function renderSpectrumChart(element, spectra, options = {}) {
  const {
    height = 260,
    markers = [],
    minimumHz = VIBRATION_FLOOR_HZ
  } = options;

  destroyExistingChart(element);

  const first = spectra[0];

  // The chart starts at the vibration floor. Near-DC bins carry
  // maneuver energy many times taller than any real shake, and
  // plotted together they flatten every vibration peak the
  // verdict talks about into an invisible ripple — the evidence
  // chart must be able to SHOW the peak it is cited for.
  const firstBin = first.spectrum.frequencies.findIndex(
    (hz) => hz >= minimumHz
  );
  const from = firstBin < 0 ? 0 : firstBin;

  const data = [
    Float64Array.from(first.spectrum.frequencies.slice(from)),
    ...spectra.map((entry) =>
      Float64Array.from(entry.spectrum.magnitudes.slice(from))
    )
  ];

  const chart = new uPlot(
    {
      width: element.clientWidth || 640,
      height,
      padding: [12, 8, 0, 0],
      cursor: { drag: { x: true, y: false } },
      hooks: {
        draw: [
          (u) => {
            if (!markers.length) {
              return;
            }

            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
            ctx.fillStyle = "#dce8ff";
            ctx.setLineDash([4, 4]);
            ctx.font = "13px sans-serif";
            ctx.textAlign = "center";

            let labelRow = 0;
            let lastLabelX = -Infinity;

            for (const marker of markers) {
              const x = u.valToPos(marker.hz, "x", true);

              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) {
                continue;
              }

              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();

              // Stagger labels vertically when peaks crowd
              // together, so they never overprint each other.
              if (x - lastLabelX < 150) {
                labelRow = (labelRow + 1) % 3;
              } else {
                labelRow = 0;
              }

              lastLabelX = x;
              ctx.fillText(marker.label, x, u.bbox.top + 14 + labelRow * 15);
            }

            ctx.restore();
          }
        ]
      },
      scales: {
        x: { time: false }
      },
      axes: [
        {
          ...AXIS_STYLE,
          label: "Frequency (Hz)",
          labelSize: 22
        },
        {
          ...AXIS_STYLE,
          label: "Noise amplitude",
          labelSize: 22,
          size: 62
        }
      ],
      series: [
        {
          label: "Hz",
          value: (self, value) =>
            value == null ? "--" : value.toFixed(0)
        },
        ...spectra.map((entry, index) => ({
          label: friendlyLabel(entry.label),
          stroke: entry.color ?? CHART_COLORS[index % CHART_COLORS.length],
          width: 1.4,
          points: { show: false },
          value: (self, value) =>
            value == null ? "--" : value.toFixed(2)
        }))
      ]
    },
    data,
    element
  );

  element.__blackboxLabChart = chart;
  watchResize(element, chart);
  buildChartFooter(element, chart, [], { withStats: false });

  return chart;
}
