import { analyzeFlightStepResponse } from "../src/analysis/stepResponseAnalysis.js";

const lines = ["time,setpoint[0],gyroADC[0]"];
for (let i = 0; i < 6000; i += 1) {
  const second = i / 1000;
  let sp = 0;
  if ((second % 2.0) > 0.2 && (second % 2.0) < 1.2) sp = 120;
  const gy = sp;
  lines.push(`${Math.round(i * 1000)},${sp},${gy}`);
}
const res = analyzeFlightStepResponse(lines, { smoothFactor: 1, yCorrection: true, minInput: 20 });
console.log("result:", JSON.stringify(res.axes.map((a) => ({ axis: a.axis, available: a.available, numSegments: a.numSegments, reason: a.reason, metrics: a.metrics, timeMs: a.timeMs.slice(0,5), stepResponse: a.stepResponse.slice(0,5) })), null, 2));
