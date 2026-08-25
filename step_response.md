# Step Response Analysis Algorithm Report

## 1. Overview

This document describes the algorithms used by `pid_step_response` to calculate the PID step response from Betaflight / Rotorflight blackbox (`.bbl`) logs. The implementation is a faithful Python re-implementation of the FFT-based deconvolution method used by [PIDtoolbox](https://github.com/bw1129/PIDtoolbox) (`PTstepcalc.m`). It is designed to give tuners a repeatable, quantitative view of how each axis (Roll, Pitch, Yaw) responds to stick inputs.

## 2. High-Level Pipeline

The complete analysis pipeline consists of the following stages:

1. **BBL parsing** — read raw blackbox frames, extract time, setpoint, gyro and PID header data.
2. **Pre-processing** — optionally smooth the gyro trace, handle NaN values, and resample to a consistent time basis.
3. **Segmentation** — split the flight into overlapping windows and keep only those with enough stick input.
4. **Deconvolution per segment** — recover the impulse response from setpoint and gyro using FFT-based division, then integrate it to obtain a step response.
5. **Quality control** — discard segments whose steady-state gain is outside a sane range.
6. **Averaging** — combine all valid segment step responses into a single response curve per axis.
7. **Metric extraction** — compute rise time, maximum overshoot and settling time from the averaged curve.
8. **Visualization / export** — render the response curves and export numerical results.

The remainder of this report walks through each stage in detail, including the exact formulas, design choices, and edge-case handling.

## 3. Input Data

### 3.1 Source: Blackbox Logs

A blackbox log is a binary file that contains one or more flight sessions ("logs"). Each log is a time-series of flight-controller frames. The library uses the bundled `orangebox` parser to load frames and header metadata.

Fields required for step response analysis:

| Field | Description | Typical name(s) in log |
|-------|-------------|------------------------|
| Time | Microseconds since arming | `time`, `time_us`, `loopIteration` |
| Roll setpoint | Stick / target roll rate (deg/s) | `setpoint[0]`, `setpoint_0`, `rcCommand[0]` |
| Pitch setpoint | Stick / target pitch rate (deg/s) | `setpoint[1]`, `setpoint_1`, `rcCommand[1]` |
| Yaw setpoint | Stick / target yaw rate (deg/s) | `setpoint[2]`, `setpoint_2`, `rcCommand[2]` |
| Roll gyro | Measured roll rate (deg/s) | `gyroADC[0]`, `gyroADC_0`, `gyro[0]` |
| Pitch gyro | Measured pitch rate (deg/s) | `gyroADC[1]`, `gyroADC_1`, `gyro[1]` |
| Yaw gyro | Measured yaw rate (deg/s) | `gyroADC[2]`, `gyroADC_2`, `gyro[2]` |

The parser looks up each column by a list of candidate names because field naming conventions differ between firmware revisions (Betaflight, Rotorflight, etc.). If a column cannot be found, that axis is skipped.

### 3.2 PID Metadata

For tuning context, the library also extracts PID coefficients from the log headers. Supported formats:

- `{axis}PID` as a comma-separated string or list, e.g. `"45,80,35"`.
- Rotorflight 5-element PID arrays: `[P, I, D, FF, Boost]`.
- Alternative keys such as `rollPitchYawP[0]`, `{axis}_p`, `p_term`, `feedforward_weight`, `ff_weight`, `d_min`, etc.

The extracted values populate a `PIDParams` dataclass (`p`, `i`, `d`, `f`, `boost`, `d_min`).

### 3.3 Log Rate

The log rate is needed to convert sample indices into wall-clock time. It is computed from the median inter-frame time:

```
dt_us = median(diff(time_us), ignoring NaN and non-positive values)
log_rate = 1000.0 / dt_us   # samples per millisecond
```

For example, a 4 kHz log has `dt_us = 250` and `log_rate = 4.0`.

## 4. Pre-Processing

### 4.1 Length Normalization and NaN Handling

The setpoint and gyro arrays are first truncated to the same length and any `NaN` values are replaced with `0.0`:

```
n = min(len(setpoint), len(gyro))
setpoint = setpoint[:n]
gyro     = gyro[:n]
setpoint = nan_to_num(setpoint, 0.0)
gyro     = nan_to_num(gyro, 0.0)
```

This avoids FFT and cumulative-sum calculations from propagating NaNs into the final result.

### 4.2 Optional Gyro Smoothing

A LOWESS (Locally Weighted Scatterplot Smoothing) filter can be applied to the gyro signal before deconvolution. The smoothing level is controlled by `smooth_factor`:

| `smooth_factor` | Meaning | LOWESS window |
|-----------------|---------|---------------|
| 1 | Off | 1 (no smoothing) |
| 2 | Low | 20 samples |
| 3 | Medium | 40 samples |
| 4 | High | 60 samples |

This matches PIDtoolbox's `smoothVals = [1, 20, 40, 60]`.

The LOWESS implementation is a simplified tricube-kernel smoother. For each sample `i`:

```
window = data[max(0, i - half) : min(n, i + half + 1)]
center = i - start_of_window
distances = |x - center| / (half + 1)
weights = (1 - distances^3)^3   for distances < 1, else 0
smoothed[i] = sum(weights * window) / sum(weights)
```

If the total weight is zero, the original sample is kept.

> **Design note:** Smoothing is applied only to the gyro (output), not to the setpoint (input). This reduces high-frequency noise in the measured response without altering the command signal that drives the deconvolution.

## 5. Segmentation

### 5.1 Why Segment?

A flight contains many stick movements. The algorithm does not assume a single isolated step input; instead it treats many short windows as repeated experiments and averages their resulting step responses. This makes the analysis robust to varying stick inputs and flight duration.

### 5.2 Segment Geometry

The constants mirror PIDtoolbox:

- `segment_length = log_rate * 2000` samples → 2-second windows.
- `wnd = log_rate * 1000 * 0.5` samples → 500 ms step response window.
- `step_resp_duration_ms = 500` → the longest time shown.
- `pad_length = 100` → zero-padding on each side of a segment before FFT.

### 5.3 Subsampling Factor

To avoid processing overlapping 2-second windows at every single sample, a subsampling factor is chosen based on total file duration:

```
if file_dur_sec <= 20:   subsample_factor = 10
elif file_dur_sec <= 60: subsample_factor = 7
else:                    subsample_factor = 3
```

Segment start indices are then generated with a stride of `segment_length / subsample_factor`:

```
segment_step = max(1, round(segment_length / subsample_factor))
segment_vector = 0, segment_step, 2*segment_step, ...
```

Shorter files use a coarser stride (fewer, more independent segments); longer files use a finer stride (more averaged segments).

### 5.4 Input-Signal Threshold

Only segments that contain a large enough command are kept. The threshold is `min_input = 20` deg/s:

```
if max(|setpoint_segment|) >= 20:
    keep segment
```

This ensures the deconvolution is driven by meaningful stick motion rather than noise or hover-level corrections.

## 6. FFT-Based Deconvolution

### 6.1 Mathematical Goal

The flight controller is modeled as a single-input single-output (SISO) linear time-invariant (LTI) system:

```
Gyro(t) = (Setpoint * h)(t)
```

where `*` denotes convolution and `h(t)` is the impulse response of the closed-loop attitude/rate system. The step response `s(t)` is the integral of `h(t)`:

```
s(t) = ∫ h(τ) dτ
```

In the frequency domain, convolution becomes multiplication:

```
G(f) = S(f) · H(f)
H(f) = G(f) / S(f)
```

Direct division is ill-conditioned where `S(f)` is small, so a regularized inverse is used.

### 6.2 Per-Segment Procedure

For each kept 2-second segment:

1. **Apply a Hann window** to both setpoint and gyro to reduce spectral leakage:

   ```
   window = hanning(segment_length)
   a = gyro_segment * window
   b = setpoint_segment * window
   ```

2. **Zero-pad** both sides by `pad_length = 100` samples (PIDtoolbox convention):

   ```
   a_pad = [zeros(pad_length), a, zeros(pad_length)]
   b_pad = [zeros(pad_length), b, zeros(pad_length)]
   ```

3. **Compute normalized FFTs**:

   ```
   G = FFT(a_pad) / len(a_pad)
   H = FFT(b_pad) / len(b_pad)
   Hcon = conj(H)
   ```

4. **Regularized inverse filtering** with damping `0.0001`:

   ```
   imp = real(IFFT( (G * Hcon) / (H * Hcon + 0.0001) ))
   ```

   The denominator `H·H* + ε` prevents division by zero and suppresses frequencies where the input has little energy.

5. **Integrate to obtain the step response**:

   ```
   resptmp = cumsum(imp)
   ```

### 6.3 Design Notes

- The normalization by FFT length is kept to match the original MATLAB implementation.
- The `0.0001` regularization is a small, fixed value that works well for typical stick spectra. It is not adaptive.
- Hann windowing and padding are critical; omitting them produces noisy or biased responses.

## 7. Y-Correction (Steady-State Normalization)

Each recovered step response should converge to a steady-state gain of `1.0`, meaning the gyro eventually tracks the setpoint at unity gain. In practice, deconvolution errors, noise, and windowing cause the raw response to converge to some other value.

### 7.1 Correction Procedure

A steady-state window is defined between 200 ms and the end of the response (500 ms):

```
steady_state_window = indices where 200 < t < 500
steady_state_resp = resptmp[steady_state_window]
```

If `y_correction` is enabled (the calculator default), a scale factor is computed:

```
yoffset = 1 - mean(steady_state_resp)
resptmp = resptmp * (yoffset + 1)
```

Equivalently, the response is multiplied by `1 / mean(steady_state_resp)`, so that the corrected steady-state mean becomes `1.0`.

### 7.2 Quality Gate

After correction, the segment is accepted only if every sample in the steady-state window lies between `0.5` and `3.0`:

```
if min(steady_state_resp) > 0.5 and max(steady_state_resp) < 3:
    keep segment response
```

This removes pathological deconvolution results (e.g. from segments dominated by noise, clipping, or non-linear behavior).

### 7.3 Window Truncation

For accepted segments, only the first `wnd + 1` samples are retained, corresponding to `0 … 500 ms`:

```
step_resp = resptmp[:wnd + 1]
```

Segments containing any NaN in this window are also discarded.

## 8. Averaging

All valid segment responses are averaged sample-by-sample:

```
min_len = min(len(sr) for sr in step_responses)
step_responses = [sr[:min_len] for sr in step_responses]
avg_response = mean(step_responses, axis=0)
```

The time vector `t` is generated once as:

```
t = arange(0, 500 + 1/log_rate, 1/log_rate)
```

If the averaged response and time vector differ in length due to rounding, both are truncated to the shorter length. The function returns:

- `time_ms` — wall-clock time in milliseconds.
- `step_response` — the averaged, normalized response.
- `num_segments` — the number of segments that passed quality control.

### Edge Cases

- If no segments meet the input threshold, the function returns zero response with `num_segments = 0`.
- If all segments fail the quality gate, the same zero response is returned.
- The returned zero response is not `NaN`-contaminated, ensuring downstream metrics and plots remain safe.

## 9. Metric Calculation

`calculate_metrics(time_ms, step_response)` derives three standard control-system metrics from the averaged curve.

### 9.1 Final Value

Because the response should converge to `1.0` but may drift slightly, the final value is estimated from the last 10% of the curve:

```
final_value = mean(response[int(0.9 * N):])
```

If `|final_value|` is essentially zero, the function returns zeros for all metrics.

### 9.2 Rise Time

Rise time is defined as the first time the response reaches **50%** of the final value:

```
target_50 = 0.5 * final_value
rise_time_ms = time_ms[i] where response[i] >= target_50 first occurs
```

This matches PIDtoolbox's `latencyHalfHeight` metric. It is deliberately **not** the 10–90% rise time or the 63.2% time constant.

### 9.3 Maximum Overshoot

```
peak_value = max(response)
max_overshoot = max(0, (peak_value - final_value) / final_value)
```

The result is a ratio: `0.10` means 10% overshoot. The `max(0, …)` clamps negative values to zero, so an underdamped system with no overshoot reports `0.0`.

### 9.4 Settling Time

Settling time is defined as the last time the response leaves a ±2% band around the final value:

```
threshold = 0.02 * |final_value|
settling_time_ms = time_ms[i + 1]
where i is the last index with |response[i] - final_value| > threshold
```

If the response stays within the band from the start, settling time is `0.0`. If it never re-enters the band within the 500 ms window, the reported value will be the last time index available.

## 10. Orchestration: StepResponseAnalyzer

`StepResponseAnalyzer` coordinates the parser and calculator. The public API is:

```python
analyzer = StepResponseAnalyzer(
    smooth_factor=1,    # 1..4
    min_input=20.0,     # not currently passed into the calculator
    y_correction=False  # note: calculator default is True
)
results = analyzer.analyze("flight.bbl")        # all logs
results = analyzer.analyze("flight.bbl", log_index=1)  # single log
```

Per-log analysis:

1. Skip logs with fewer than 100 samples.
2. Create a `StepResponseResult` containing metadata (path, log index, rate, duration, headers).
3. For each axis that has both setpoint and gyro data, call `_analyze_axis`.
4. `_analyze_axis` runs `calculate_step_response` then `calculate_metrics` and stores the result in an `AxisResult`.

The analyzer's `y_correction` flag is passed to the calculator, but its `min_input` value is **not** currently used by `calculate_step_response`, which hardcodes `min_input = 20`.

## 11. Visualization

### 11.1 Step Response Plot (`plot_step_response`)

Renders the averaged response curves. Features:

- Multi-panel or single-panel layout.
- Horizontal reference lines at `y = 0` and `y = 1` (target).
- Dotted horizontal line at `1 + max_overshoot` when overshoot exceeds 1%.
- Dotted vertical line at `x = rise_time_ms`.
- Per-axis info panel with rise time, overshoot, segment count and PID values.
- X-axis limited to `[0, 500]` ms; Y-axis limited to `[-0.1, y_max]`.

### 11.2 Setpoint vs Gyro Plot (`plot_setpoint_gyro`)

Renders the raw setpoint and gyro signals for the first 2 seconds (or a custom time range). This is useful for inspecting tracking quality and confirming that deconvolution segments were driven by real stick motion.

## 12. GUI Application

`gui_step_response.py` launches a PySide6 / pyqtgraph application that wraps the analyzer:

- Open a `.bbl` file.
- Run analysis in a background worker thread (one log at a time).
- Display step response curves and setpoint/gyro overlays for Roll, Pitch and Yaw.
- Support overlaying multiple logs and selecting/focusing one log via a legend.
- Export all results to JSON.

The GUI is intentionally the primary user-facing workflow, but every core operation is also available through the library API.

## 13. Data Models

The library uses dataclasses to carry data through the pipeline:

- `PIDParams` — P, I, D, FF, Boost, D_min.
- `LogData` — raw arrays and metadata for one log.
- `AxisResult` — per-axis response, metrics and PID.
- `StepResponseResult` — container for one log with roll, pitch and yaw results.

Each model provides `to_dict()` methods that recursively convert NumPy arrays to plain Python lists, producing JSON-serializable output.

## 14. Known Limitations and Caveats

- The 50% rise-time threshold differs from the 63.2% value mentioned in the README (the code uses 50%, matching PIDtoolbox).
- `StepResponseAnalyzer.min_input` is stored but not propagated to `calculate_step_response`, which always uses 20 deg/s.
- The deconvolution assumes approximate linearity and time-invariance over a 2-second window. Aggressive stick inputs, saturation, or rapid PID changes can violate this assumption and reduce result quality.
- Y-correction is disabled by default in the analyzer but enabled by default in the calculator. Users of the high-level analyzer must set `y_correction=True` to match the calculator default.
- The regularization constant (`0.0001`) is fixed and not configurable.

## 15. References

- `pid_step_response/calculator.py` — core algorithm.
- `pid_step_response/analyzer.py` — orchestration.
- `pid_step_response/parser.py` — BBL parsing and PID extraction.
- `pid_step_response/models.py` — data structures.
- `pid_step_response/plotter.py` — matplotlib plots.
- `pid_step_response/gui_app.py` — interactive GUI.
- PIDtoolbox `PTstepcalc.m` — original MATLAB algorithm that this implementation replicates.
