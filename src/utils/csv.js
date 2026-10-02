/** Minimal RFC-4180 CSV parser (quotes, commas and newlines inside quotes). */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQ = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))
  );
}

export const CSV_TEMPLATE =
  "wallet,studentName,rollNumber,title,category,issuer,eventName,issueDate,description,certificateFile,attendanceStatus,absenceReason\n" +
  "0x0000000000000000000000000000000000000001,Asha Patil,IT2021-042,Web3 Bootcamp Certificate,certificate,SVKM IoT Dhule,Web3 Bootcamp,2026-09-01,Completed 30-day bootcamp,asha.png,present,\n";