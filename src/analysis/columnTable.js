// ======================================================
// COLUMN TABLE — the log's numbers, parsed exactly once
// ======================================================
//
// Every analysis module used to read a column by splitting every
// CSV line again: `Number(lines[row].split(",")[columnIndex])`,
// repeated per column, per axis, per headspeed profile — on a
// 16 MB log that is a 94 MB string tokenized dozens of times, and
// it is where the load time went (decode 0.85 s, engine 25 s).
//
// This table splits each line ONCE, into one Float64Array per
// column, indexed by ABSOLUTE line index (the same index every
// caller already uses). Each reader keeps its own semantics as a
// thin wrapper over the table, so the numbers it returns are the
// numbers it returned before, bit for bit:
//
//   cell present, numeric   → Number(cell)           (as before)
//   cell present, ""        → 0  (Number("") is 0)    (as before)
//                             AND listed in emptyRows(), for the
//                             readers that map "" to null
//   cell absent / not numeric → NaN                  (as before:
//                             Number(undefined) / Number("abc"))
//
// Cached per lines array (WeakMap): the engine, the labs and the
// renderer share one parse, and the memory that was spent on the
// renderer's own per-column arrays now pays for everyone.
//
// ======================================================

const TABLES = new WeakMap();

function buildTable(lines, headerIndex) {
  const headerCells = String(lines[headerIndex] ?? "").split(",");
  const width = headerCells.length;
  const rowCount = lines.length;

  const columns = new Array(width);
  for (let c = 0; c < width; c += 1) {
    const column = new Float64Array(rowCount);
    column.fill(Number.NaN);
    columns[c] = column;
  }

  // Rows whose cell was blank (after trimming), per column. Sparse:
  // Blackbox decodes never produce them; a hand-made CSV might.
  const empties = new Array(width).fill(null);

  for (let row = headerIndex + 1; row < rowCount; row += 1) {
    const line = lines[row];
    if (typeof line !== "string") continue;

    const cells = line.split(",");
    const n = cells.length < width ? cells.length : width;

    for (let c = 0; c < n; c += 1) {
      const cell = cells[c];
      const value = Number(cell);
      columns[c][row] = value;
      if (value === 0 && cell.trim() === "") {
        (empties[c] ??= []).push(row);
      }
    }
  }

  return {
    headerIndex,
    width,
    rowCount,
    rawHeaders: headerCells,
    column: (columnIndex) =>
      columnIndex >= 0 && columnIndex < width ? columns[columnIndex] : null,
    emptyRows: (columnIndex) => empties[columnIndex] ?? null
  };
}

// The table for these lines under this header row. The first call
// pays for the parse; every later call, from any module, is a
// lookup.
export function columnTableFor(lines, headerIndex) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(headerIndex) ||
    headerIndex < 0 ||
    headerIndex >= lines.length
  ) {
    return null;
  }

  let byHeader = TABLES.get(lines);
  if (!byHeader) {
    byHeader = new Map();
    TABLES.set(lines, byHeader);
  }

  let table = byHeader.get(headerIndex);
  if (!table) {
    table = buildTable(lines, headerIndex);
    byHeader.set(headerIndex, table);
  }
  return table;
}

// The readers, each reproducing one historic access pattern.

// Every finite value of a column, in row order — what
// `lines.slice(header+1).map(split).map(Number).filter(finite)` gave.
export function finiteColumnValues(lines, headerIndex, columnIndex) {
  const table = columnTableFor(lines, headerIndex);
  const column = table?.column(columnIndex);
  if (!column) return [];
  const values = [];
  for (let row = headerIndex + 1; row < table.rowCount; row += 1) {
    const value = column[row];
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

// Finite values at the given absolute row indexes, in the order
// given — what `rowIndexes.map(split→Number).filter(finite)` gave.
export function finiteValuesAtRows(lines, headerIndex, columnIndex, rowIndexes) {
  const table = columnTableFor(lines, headerIndex);
  const column = table?.column(columnIndex);
  if (!column) return [];
  const values = [];
  for (let i = 0; i < rowIndexes.length; i += 1) {
    const row = rowIndexes[i];
    const value = column[row];
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

// One value per row with null where the cell was blank or not
// numeric — what the quote-stripping, ""→null readers gave.
export function alignedColumnValues(lines, headerIndex, columnIndex) {
  const table = columnTableFor(lines, headerIndex);
  const column = table?.column(columnIndex);
  if (!column) return [];
  const blanks = table.emptyRows(columnIndex);
  const blankSet = blanks ? new Set(blanks) : null;
  const values = [];
  for (let row = headerIndex + 1; row < table.rowCount; row += 1) {
    const value = column[row];
    values.push(
      Number.isFinite(value) && !(blankSet && blankSet.has(row))
        ? value
        : null
    );
  }
  return values;
}
