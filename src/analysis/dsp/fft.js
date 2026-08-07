// ======================================================
// BLACKBOX LAB — DSP: FFT & NOISE SPECTRUM
// ======================================================
//
// A small, dependency-free radix-2 FFT plus a Welch-style
// averaged power spectrum. This is what lets the Filter
// Lab SHOW noise instead of only describing it: feed it a
// gyro trace and it returns "how much vibration lives at
// each frequency".
//
// ======================================================

// In-place iterative radix-2 FFT on interleaved buffers.
function fftInPlace(real, imag) {
  const n = real.length;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;

    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }

    j ^= bit;

    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += length) {
      let curReal = 1;
      let curImag = 0;

      for (let j = 0; j < length / 2; j += 1) {
        const evenReal = real[i + j];
        const evenImag = imag[i + j];
        const oddReal =
          real[i + j + length / 2] * curReal -
          imag[i + j + length / 2] * curImag;
        const oddImag =
          real[i + j + length / 2] * curImag +
          imag[i + j + length / 2] * curReal;

        real[i + j] = evenReal + oddReal;
        imag[i + j] = evenImag + oddImag;
        real[i + j + length / 2] = evenReal - oddReal;
        imag[i + j + length / 2] = evenImag - oddImag;

        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

function hannWindow(length) {
  const window = new Float64Array(length);

  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }

  return window;
}

// ------------------------------------------------------
// computeNoiseSpectrum(samples, sampleRateHz, options)
//
// Welch's method: split the signal into overlapping,
// Hann-windowed segments, FFT each, average the power.
// Returns { frequencies, magnitudes } ready to plot.
// ------------------------------------------------------
export function computeNoiseSpectrum(samples, sampleRateHz, options = {}) {
  const values = Array.isArray(samples)
    ? Float64Array.from(samples)
    : samples;

  if (!values || values.length < 64 || !Number.isFinite(sampleRateHz)) {
    return null;
  }

  const maxSegment = options.segmentSize ?? 4096;

  let segmentSize = 64;

  while (segmentSize * 2 <= Math.min(values.length, maxSegment)) {
    segmentSize *= 2;
  }

  const hop = segmentSize / 2; // 50% overlap
  const window = hannWindow(segmentSize);
  const half = segmentSize / 2;

  const power = new Float64Array(half);
  let segments = 0;

  // Remove the DC offset so bin 0 doesn't swamp the plot.
  let mean = 0;

  for (let i = 0; i < values.length; i += 1) {
    mean += values[i];
  }

  mean /= values.length;

  const real = new Float64Array(segmentSize);
  const imag = new Float64Array(segmentSize);

  for (
    let start = 0;
    start + segmentSize <= values.length;
    start += hop
  ) {
    for (let i = 0; i < segmentSize; i += 1) {
      real[i] = (values[start + i] - mean) * window[i];
      imag[i] = 0;
    }

    fftInPlace(real, imag);

    // Amplitude calibration: a pure sine of amplitude A
    // should read ≈ A in its bin. Factor 2 folds the
    // negative frequencies; 0.5 is the Hann window's
    // coherent gain.
    const scale = 2 / (segmentSize * 0.5);

    for (let bin = 0; bin < half; bin += 1) {
      const amplitude =
        Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]) * scale;
      power[bin] += amplitude * amplitude;
    }

    segments += 1;
  }

  if (segments === 0) {
    return null;
  }

  const frequencies = new Float64Array(half);
  const magnitudes = new Float64Array(half);

  for (let bin = 0; bin < half; bin += 1) {
    frequencies[bin] = (bin * sampleRateHz) / segmentSize;
    magnitudes[bin] = Math.sqrt(power[bin] / segments);
  }

  return {
    frequencies,
    magnitudes,
    segmentSize,
    segments,
    sampleRateHz
  };
}

// Below this frequency a gyro spectrum shows the pilot flying,
// not the machine shaking: stick inputs and slow maneuvers put
// their energy here, and no verdict, marker or advisor reads
// anything below it. Every consumer of "the strongest peak"
// shares this floor so they can never disagree about which
// axis carries the vibration story.
export const VIBRATION_FLOOR_HZ = 10;

// The largest magnitude at or above `minimumHz` — the peak that
// is allowed to speak for vibration. A plain max over the whole
// spectrum is dominated by near-DC maneuver energy and picks the
// most-flown axis, not the most-shaking one.
export function peakMagnitudeAbove(
  spectrum,
  minimumHz = VIBRATION_FLOOR_HZ
) {
  if (!spectrum) {
    return 0;
  }

  const { frequencies, magnitudes } = spectrum;
  let peak = 0;

  for (let i = 0; i < frequencies.length; i += 1) {
    if (
      frequencies[i] >= minimumHz &&
      Number.isFinite(magnitudes[i]) &&
      magnitudes[i] > peak
    ) {
      peak = magnitudes[i];
    }
  }

  return peak;
}

// Estimate the sample rate from the time column (microseconds).
export function estimateSampleRate(timeValuesMicroseconds) {
  if (!timeValuesMicroseconds || timeValuesMicroseconds.length < 2) {
    return null;
  }

  const first = timeValuesMicroseconds[0];
  const last = timeValuesMicroseconds[timeValuesMicroseconds.length - 1];
  const spanSeconds = (last - first) / 1_000_000;

  if (spanSeconds <= 0) {
    return null;
  }

  return (timeValuesMicroseconds.length - 1) / spanSeconds;
}

// ------------------------------------------------------
// computeNoiseSpectrumOverRuns(runs, sampleRateHz, options)
//
// One 4-second slice is a coin flip: an intermittent shake
// lands inside it on one flight and outside it on the next,
// and two logs of the same machine tell different stories.
// This averages Welch spectra across every stable run the
// flight offers — same bins, power-weighted by how many
// segments each run contributed — so the noise picture is
// the flight's, not the slice's.
// ------------------------------------------------------
export function computeNoiseSpectrumOverRuns(runs, sampleRateHz, options = {}) {
  if (!Array.isArray(runs) || !Number.isFinite(sampleRateHz)) {
    return null;
  }

  const usable = runs.filter(
    (run) => run && run.length >= 64
  );

  if (usable.length === 0) {
    return null;
  }

  const longest = usable.reduce(
    (best, run) => Math.max(best, run.length),
    0
  );

  const maxSegment = options.segmentSize ?? 4096;

  // Every run must share one segment size or the bins differ
  // and cannot be averaged. The longest run sets it; shorter
  // runs that cannot fill one segment sit this out.
  let segmentSize = 64;

  while (segmentSize * 2 <= Math.min(longest, maxSegment)) {
    segmentSize *= 2;
  }

  const half = segmentSize / 2;
  const power = new Float64Array(half);
  let totalSegments = 0;
  let frequencies = null;

  for (const run of usable) {
    if (run.length < segmentSize) {
      continue;
    }

    const spectrum = computeNoiseSpectrum(run, sampleRateHz, {
      segmentSize
    });

    if (!spectrum || spectrum.segmentSize !== segmentSize) {
      continue;
    }

    for (let bin = 0; bin < half; bin += 1) {
      power[bin] +=
        spectrum.magnitudes[bin] *
        spectrum.magnitudes[bin] *
        spectrum.segments;
    }

    totalSegments += spectrum.segments;
    frequencies = spectrum.frequencies;
  }

  if (totalSegments === 0 || !frequencies) {
    return null;
  }

  const magnitudes = new Float64Array(half);

  for (let bin = 0; bin < half; bin += 1) {
    magnitudes[bin] = Math.sqrt(power[bin] / totalSegments);
  }

  return {
    frequencies,
    magnitudes,
    segmentSize,
    segments: totalSegments,
    sampleRateHz
  };
}
