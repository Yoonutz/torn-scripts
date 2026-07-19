function buildTrainingIndexFast_(logsSheet) {
  const lastRow = logsSheet.getLastRow();
  const byName = new Map();
  if (lastRow < 1) return { byName };

  const rows = logsSheet.getRange(1, 1, lastRow, 2).getValues();
  const re = /<a[^>]*>\s*([^<]+?)\s*<\/a>\s*has been trained by the director/i;

  for (let i = 0; i < rows.length; i++) {
    const sheetRow = i + 1;
    const ts = Number(rows[i][0]);
    const text = String(rows[i][1] || "");
    if (!Number.isFinite(ts)) continue;

    const m = text.match(re);
    if (!m) continue;

    const name = String(m[1] || "").trim();
    if (!name) continue;

    const cleanText = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    let rec = byName.get(name);
    if (!rec) {
      rec = { ts: [], rows: [], text: [] };
      byName.set(name, rec);
    }

    rec.ts.push(ts);
    rec.rows.push(sheetRow);
    rec.text.push(cleanText);
  }

  for (const rec of byName.values()) {
    if (rec.ts.length <= 1) continue;

    const idx = rec.ts.map((_, j) => j);
    idx.sort((a, b) => rec.ts[a] - rec.ts[b]);

    rec.ts = idx.map(j => rec.ts[j]);
    rec.rows = idx.map(j => rec.rows[j]);
    rec.text = idx.map(j => rec.text[j]);
  }

  return { byName };
}

function lowerBound_(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countSince_(tsAsc, epochSeconds) {
  if (!tsAsc || tsAsc.length === 0) return 0;
  const idx = lowerBound_(tsAsc, epochSeconds);
  return tsAsc.length - idx;
}

function findFirstRowSince_(tsAsc, rowsAsc, epochSeconds) {
  if (!tsAsc || !rowsAsc || tsAsc.length === 0) return null;
  const idx = lowerBound_(tsAsc, epochSeconds);
  return idx < rowsAsc.length ? rowsAsc[idx] : null;
}