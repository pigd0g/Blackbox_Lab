// ======================================================
// TESTS — the column table returns what the split loops returned
// ======================================================
//
// One parse for everyone, and bit-for-bit the same numbers the
// per-row `Number(line.split(",")[i])` readers produced — including
// the two edge semantics those readers disagreed on (a blank cell is
// 0 to the finite readers and null to the aligned reader).
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  columnTableFor,
  finiteColumnValues,
  finiteValuesAtRows,
  alignedColumnValues
} from "../src/analysis/columnTable.js";
import {
  getColumnValues,
  getColumnSamples,
  getColumnValuesByRowIndexes
} from "../src/analysis/mathHelpers.js";

const LINES = [
  '"Product","x"',
  "loopIteration,time,setpoint[0],gyroADC[0],note",
  "0,1000,10,9.5,ok",
  "1,1010,,9.7,ok",          // blank setpoint
  "2,1020,abc,9.9",          // non-numeric setpoint, short row (no note)
  "3,1030, 12 ,10.1,ok",     // padded cell
  "4,1040,14,1e1,ok"         // exponent form
];
const HEADER = 1;

test("finite readers: blank → 0 (Number(\"\") is 0), non-numeric/missing → skipped", () => {
  assert.deepEqual(finiteColumnValues(LINES, HEADER, 2), [10, 0, 12, 14]);
  assert.deepEqual(getColumnValues(LINES, HEADER, "setpoint[0]"), [10, 0, 12, 14]);
  assert.deepEqual(finiteColumnValues(LINES, HEADER, 3), [9.5, 9.7, 9.9, 10.1, 10]);
  // the short row has no 'note' cell at all → NaN → skipped; "ok" is NaN too
  assert.deepEqual(finiteColumnValues(LINES, HEADER, 4), []);
});

test("row-indexed readers keep order and absolute row indexes", () => {
  assert.deepEqual(finiteValuesAtRows(LINES, HEADER, 2, [6, 2, 3, 4, 99]), [14, 10, 0]);
  assert.deepEqual(getColumnValuesByRowIndexes(LINES, HEADER, "setpoint[0]", [6, 2, 3, 4, 99]), [14, 10, 0]);
  assert.deepEqual(
    getColumnSamples(LINES, HEADER, "setpoint[0]").map((s) => `${s.rowIndex}:${s.value}`),
    ["2:10", "3:0", "5:12", "6:14"]
  );
});

test("aligned reader: one value per row, blank AND non-numeric → null", () => {
  assert.deepEqual(alignedColumnValues(LINES, HEADER, 2), [10, null, null, 12, 14]);
  assert.deepEqual(alignedColumnValues(LINES, HEADER, 4), [null, null, null, null, null]);
});

test("one parse per lines array: the table is cached and shared", () => {
  const a = columnTableFor(LINES, HEADER);
  const b = columnTableFor(LINES, HEADER);
  assert.equal(a, b);
  assert.equal(a.width, 5);
  assert.equal(a.rowCount, LINES.length);
  assert.ok(Number.isNaN(a.column(2)[0]), "metadata rows are NaN");
  assert.deepEqual(a.emptyRows(2), [3]);
  assert.equal(columnTableFor(LINES, 99), null);
});
