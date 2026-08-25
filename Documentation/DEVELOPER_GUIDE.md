# Blackbox Lab — Developer Guide

A tour of what's inside, and how to keep building on it.

## The big picture

```
src/
  index.js            Electron main process (windows, PDF export, IPC)
  preload.js          Electron preload
  index.html          All screens (one <section data-screen> each)
  index.css           Styling
  renderer.js         Wires everything: file → decode → analyze → draw
  version.js          APP_VERSION + the startup update check
  ui/
    navigation.js     Sidebar ⇄ screen switching
    charts.js         uPlot wrappers (time series + spectrum)
    screenUpdater.js  Results renderer
    replayFields.js   Replay's searchable field browser
    stickDisplay.js   Stick-position overlays
    reportBuilder.js  The PDF report (same wording as the app)
  analysis/
    logAnalysisBuilder.js   One decoded flight → every lab's results
    columnTable.js          One CSV parse into typed columns (speed)
    flightEvents.js         Stick commands + measured responses
    recommendationEngine.js What To Try Next (evidence-gated)
    recommendationContract.js  One priority rule for every surface
    packBuilder.js / packSnippet.js  Change Packs + CLI snippets
    compareFlights.js / demandSignature.js  Like-for-like comparison
    craftHistory.js         The Health Record
    crossAxisAnalysis.js / profileSegments.js  Cross-axis, per-profile
    …one module per lab (filter, pid, governor, esc, battery,
    signal, bec, servo, telemetry) plus their events/scoring helpers
    bbl/              Native binary .bbl decoder
      byteStream.js     encodings (VB, zigzag, TAG groups)
      headerParser.js   header lines → field definitions
      frameDecoder.js   frames + predictors + corruption resync
      bblDecoder.js     whole files → decoded flights
      csvAdapter.js     decoded flight → CSV-shaped lines + column table
    dsp/
      fft.js          FFT + Welch noise spectrum
  contribute/         Anonymized log sharing (consent-gated;
                      see Documentation/CONTRIBUTED-DATA.md)
  profiles/           Craft profile storage
tools/
  generateSampleLog.mjs   Synthetic test flights (known truth)
samples/                  Ready-made .bbl flights incl. the Academy set
test/                     run with: npm test
```

## The key design decisions

- **The decoder does not feed the analysis directly.** Each decoded
  flight is rendered into the same CSV-shaped lines the analysis
  modules have always consumed (`csvAdapter.js`), which also
  registers a typed column table for the fast path. Analysis code
  stays format-agnostic; CSV files still work as before.
- **Calibration is measured, never guessed.** Every threshold that
  flags a flight is anchored to percentiles of the contributed
  fleet; the comment above each bar says what was measured and when.
- **One priority rule.** `recommendationContract.js` ranks findings
  once; Home, the Change Pack, the labs, Technical and the PDF all
  consume the same ranking, so no surface contradicts another.
- **Evidence gates speech.** A card that cannot cite events,
  confidence and (where relevant) the verifying metric for the next
  flight stays silent or says what is missing.

## How the binary decoder works (short version)

A .bbl is ASCII header lines, then binary frames. Each header
"Field" line describes, per field: a PREDICTOR (what value we
expect) and an ENCODING (how the difference is stored). Decoding
reverses both: read the encoded delta, add the prediction.
Intraframes ("I") anchor the stream; interframes ("P") build on
the previous two frames; corrupt bytes are skipped by scanning to
the next plausible frame marker (see `frameDecoder.js`). It was
implemented clean-room from the published Blackbox format
specification. The whole project is GPL-3.0 (see LICENSE).

## Working on the code

- Point yourself (or your AI assistant) at ONE module and its test
  file — small, precise changes beat "improve the app".
- `npm test` after every change; the decoder and calibration tests
  catch regressions instantly.
- The generator is your friend: plant a known problem in a sample
  flight, then check whether the analysis finds it.
- Keep the idiom: ES modules, descriptive names, one module per
  concern, section banners.

## Adding a new Lab (recipe)

1. Add a `<section data-screen="mylab">` in index.html and a
   sidebar button with `data-target="mylab"`.
2. Write `src/analysis/myLabAnalysis.js` consuming the CSV lines
   (see filterAnalysis.js for the pattern).
3. Call it from `logAnalysisBuilder.js`, render results in
   `screenUpdater.js`, add charts via `ui/charts.js`.
4. Add a test in `test/` using the sample generator.
5. Wire the lab into the verdict/priority surfaces
   (`flightVerdict.js`, `recommendationContract.js`) so its
   findings rank with everyone else's.

## Releases

`npm run make` builds installers via Electron Forge. CI runs the
test suite on every push (`.github/workflows/ci.yml`); tagged
releases build the platform installers.
