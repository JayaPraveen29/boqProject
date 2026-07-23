import { useState, useEffect, useMemo } from "react";
import { db, collection, getDocs } from "../../dataClient";
import "./SingleSectionReport.css";

export default function SingleSectionReport() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);

  const [allSections, setAllSections] = useState([]);
  const [allSizes, setAllSizes] = useState([]);
  const [sectionSizeRelations, setSectionSizeRelations] = useState([]);

  const [selectedPoc, setSelectedPoc] = useState("");
  const [selectedDrawingNumber, setSelectedDrawingNumber] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedSize, setSelectedSize] = useState("");

  // ─── Fetch master data + entries ───────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    try {
      const [secSnap, sizeSnap, relSnap, entriesSnap] = await Promise.all([
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "thicknesses")),
        getDocs(collection(db, "sectionSizeRelations")),
        getDocs(collection(db, "entries")),
      ]);

      // Dedupe by value (case-insensitive) so duplicate Firestore docs
      // sharing the same value don't show up twice in the dropdowns.
      const mapSnap = (snap) => {
        const seen = new Map();
        snap.docs.forEach((d) => {
          const value = d.data().value?.trim() || "";
          const key = value.toLowerCase();
          if (value && !seen.has(key)) {
            seen.set(key, { id: d.id, value });
          }
        });
        return Array.from(seen.values()).sort((a, b) =>
          a.value.localeCompare(b.value, undefined, { numeric: true })
        );
      };

      setAllSections(mapSnap(secSnap));
      setAllSizes(mapSnap(sizeSnap));
      setSectionSizeRelations(relSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      setEntries(entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error fetching Single Section report data:", e);
      alert("Error fetching data from Firebase");
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // ─── Distinct POC Nos derived from entries ─────────────────────────────────
  const allPocs = useMemo(() => {
    const pocSet = new Set();
    entries.forEach((entry) => {
      const pocNo = (entry.pocNo || entry.poNo || "").toString().trim();
      if (pocNo) pocSet.add(pocNo);
    });
    return Array.from(pocSet).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [entries]);

  // ─── Cascading Drawing Number options for the chosen POC No ────────────────
  // Strictly derived from entries: if a POC is selected, only Drawing
  // Numbers that actually occur in that POC's entries are shown.
  const availableDrawingNumbers = useMemo(() => {
    const pocNorm = selectedPoc.trim().toLowerCase();
    const drawingSet = new Set();

    entries.forEach((entry) => {
      const entryPoc = (entry.pocNo || entry.poNo || "").toString().trim().toLowerCase();
      if (selectedPoc && entryPoc !== pocNorm) return;
      const drawingNumber = (entry.drawingNumber || "").toString().trim();
      if (drawingNumber) drawingSet.add(drawingNumber);
    });

    return Array.from(drawingSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [selectedPoc, entries]);

  // Reset the Drawing Number choice if it's no longer valid for the newly picked POC
  useEffect(() => {
    if (selectedDrawingNumber && !availableDrawingNumbers.includes(selectedDrawingNumber)) {
      setSelectedDrawingNumber("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoc]);

  // ─── Cascading Section options for the chosen POC No (+ Drawing Number) ───
  // Strictly derived from entries: only Sections that actually occur in the
  // selected POC's / Drawing Number's entries are shown — nothing else.
  const availableSections = useMemo(() => {
    if (!selectedPoc && !selectedDrawingNumber) return allSections;
    const pocNorm = selectedPoc.trim().toLowerCase();
    const drgNorm = selectedDrawingNumber.trim().toLowerCase();
    const sectionsInScope = new Set();

    entries.forEach((entry) => {
      const entryPoc = (entry.pocNo || entry.poNo || "").toString().trim().toLowerCase();
      if (selectedPoc && entryPoc !== pocNorm) return;
      const entryDrawing = (entry.drawingNumber || "").toString().trim().toLowerCase();
      if (selectedDrawingNumber && entryDrawing !== drgNorm) return;
      if (!Array.isArray(entry.items)) return;
      entry.items.forEach((item) => {
        const sec = (item.section ?? "").toString().trim().toLowerCase();
        if (sec) sectionsInScope.add(sec);
      });
    });

    return allSections.filter((s) => sectionsInScope.has(s.value.trim().toLowerCase()));
  }, [selectedPoc, selectedDrawingNumber, allSections, entries]);

  // Reset the Section choice if it's no longer valid for the newly picked POC / Drawing Number
  useEffect(() => {
    if (selectedSection && !availableSections.some((s) => s.value === selectedSection)) {
      setSelectedSection("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoc, selectedDrawingNumber]);

  // ─── Cascading Angle/Size options for the chosen Section (+ POC/Drawing) ──
  // Strictly derived from entries: only sizes that actually occur under the
  // selected Section (and, if set, the selected POC / Drawing Number) are shown.
  const availableSizes = useMemo(() => {
    if (!selectedSection) return allSizes;
    const pocNorm = selectedPoc.trim().toLowerCase();
    const drgNorm = selectedDrawingNumber.trim().toLowerCase();
    const sectionNorm = selectedSection.trim().toLowerCase();
    const sizesForSection = new Set();

    entries.forEach((entry) => {
      if (selectedPoc) {
        const entryPoc = (entry.pocNo || entry.poNo || "").toString().trim().toLowerCase();
        if (entryPoc !== pocNorm) return;
      }
      if (selectedDrawingNumber) {
        const entryDrawing = (entry.drawingNumber || "").toString().trim().toLowerCase();
        if (entryDrawing !== drgNorm) return;
      }
      if (!Array.isArray(entry.items)) return;
      entry.items.forEach((item) => {
        const itemSection = (item.section ?? "").toString().trim().toLowerCase();
        if (itemSection !== sectionNorm) return;
        const itemSize = (item.size ?? "").toString().trim().toLowerCase();
        if (itemSize) sizesForSection.add(itemSize);
      });
    });

    return allSizes.filter((s) => sizesForSection.has(s.value.trim().toLowerCase()));
  }, [selectedSection, selectedPoc, selectedDrawingNumber, allSizes, entries]);

  // Reset the size choice if it's no longer valid for the newly picked section/POC/Drawing Number
  useEffect(() => {
    if (selectedSize && !availableSizes.some((s) => s.value === selectedSize)) {
      setSelectedSize("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, selectedPoc, selectedDrawingNumber]);

  // ─── Build the report rows: one row per POC No + Drawing No combination ───
  // Columns: POC No, Drawing No, Drg Weight, Calc. Weight, Difference, Difference %.
  const reportRows = useMemo(() => {
    if (!selectedSection) return [];

    const sectionNorm = selectedSection.trim().toLowerCase();
    const sizeNorm = selectedSize.trim().toLowerCase();
    const pocNorm = selectedPoc.trim().toLowerCase();
    const drgNorm = selectedDrawingNumber.trim().toLowerCase();

    const grouped = {}; // key: pocNo|||drawingNumber

    entries.forEach((entry) => {
      if (!Array.isArray(entry.items)) return;

      const pocNo = (entry.pocNo || entry.poNo || "—").toString().trim() || "—";
      const drawingNumber = (entry.drawingNumber || "—").toString().trim() || "—";

      if (selectedPoc && pocNo.toLowerCase() !== pocNorm) return;
      if (selectedDrawingNumber && drawingNumber.toLowerCase() !== drgNorm) return;

      const matchingItems = entry.items.filter((item) => {
        const itemSection = (item.section ?? "").toString().trim().toLowerCase();
        const itemSize = (item.size ?? "").toString().trim().toLowerCase();
        if (itemSection !== sectionNorm) return false;
        if (selectedSize && itemSize !== sizeNorm) return false;
        return true;
      });

      if (matchingItems.length === 0) return;

      const drgWeightSum = matchingItems.reduce((sum, item) => {
        const w = parseFloat(item.drgWeight);
        return sum + (isNaN(w) ? 0 : w);
      }, 0);
      const totalWeightSum = matchingItems.reduce((sum, item) => {
        const w = parseFloat(item.totalWeight);
        return sum + (isNaN(w) ? 0 : w);
      }, 0);

      const key = `${pocNo}|||${drawingNumber}`;
      if (!grouped[key]) {
        grouped[key] = { pocNo, drawingNumber, drgWeight: 0, totalWeight: 0 };
      }
      grouped[key].drgWeight += drgWeightSum;
      grouped[key].totalWeight += totalWeightSum;
    });

    return Object.values(grouped).sort((a, b) => {
      const pocCmp = a.pocNo.localeCompare(b.pocNo, undefined, { numeric: true });
      if (pocCmp !== 0) return pocCmp;
      return a.drawingNumber.localeCompare(b.drawingNumber, undefined, { numeric: true });
    });
  }, [entries, selectedSection, selectedSize, selectedPoc, selectedDrawingNumber]);

  const grandTotals = useMemo(() => {
    return reportRows.reduce(
      (acc, row) => {
        acc.drgWeight += row.drgWeight;
        acc.totalWeight += row.totalWeight;
        return acc;
      },
      { drgWeight: 0, totalWeight: 0 }
    );
  }, [reportRows]);

  const fmt3 = (v) => {
    const n = Number(v);
    return isNaN(n) ? "0.000" : n.toFixed(3);
  };

  // Difference % = (Drg Wt - Calc Wt) / Drg Wt * 100
  const getDiffPercent = (drgWeight, totalWeight) => {
    if (!drgWeight) return null;
    return ((drgWeight - totalWeight) / drgWeight) * 100;
  };

  const fmtPercent = (v) => {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return `${v.toFixed(2)}%`;
  };

  const hasSelection = !!selectedSection;

  return (
    <div className="ssr-container">
      <h1 className="ssr-heading">Single Section Report</h1>

      <div className="ssr-toolbar">
        <div className="ssr-filter">
          <label>POC No</label>
          <select
            className="ssr-select"
            value={selectedPoc}
            onChange={(e) => setSelectedPoc(e.target.value)}
          >
            <option value="">All POCs</option>
            {allPocs.map((poc) => (
              <option key={poc} value={poc}>{poc}</option>
            ))}
          </select>
        </div>

        <div className="ssr-filter">
          <label>Drawing No</label>
          <select
            className="ssr-select"
            value={selectedDrawingNumber}
            onChange={(e) => setSelectedDrawingNumber(e.target.value)}
          >
            <option value="">All Drawing Nos</option>
            {availableDrawingNumbers.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="ssr-filter">
          <label>Section</label>
          <select
            className="ssr-select"
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
          >
            <option value="">Select Section</option>
            {availableSections.map((s) => (
              <option key={s.id} value={s.value}>{s.value}</option>
            ))}
          </select>
        </div>

        <div className="ssr-filter">
          <label>Angle / Size</label>
          <select
            className="ssr-select"
            value={selectedSize}
            onChange={(e) => setSelectedSize(e.target.value)}
            disabled={!selectedSection}
          >
            <option value="">All Sizes</option>
            {availableSizes.map((s) => (
              <option key={s.id} value={s.value}>{s.value}</option>
            ))}
          </select>
        </div>

        <button className="ssr-refresh-btn" onClick={fetchData} disabled={loading}>
          {loading ? "Loading..." : "⟳ Refresh"}
        </button>
      </div>

      {loading ? (
        <div className="ssr-loading">
          <div className="ssr-spinner"></div>
          <span>Loading...</span>
        </div>
      ) : !hasSelection ? (
        <div className="ssr-empty">Select a Section (and optionally a POC / Drawing No / Angle-Size) to generate the report.</div>
      ) : reportRows.length === 0 ? (
        <div className="ssr-empty">
          No entries found for {selectedSection}
          {selectedSize ? ` — ${selectedSize}` : ""}
          {selectedPoc ? ` — POC ${selectedPoc}` : ""}
          {selectedDrawingNumber ? ` — Drg ${selectedDrawingNumber}` : ""}.
        </div>
      ) : (
        <div className="ssr-table-wrapper">
          <table className="ssr-table">
            <thead>
              <tr>
                <th colSpan={7} className="ssr-title-row">
                  {selectedSection}{selectedSize ? ` ${selectedSize}` : ""}
                  {selectedPoc ? ` — POC ${selectedPoc}` : ""}
                  {selectedDrawingNumber ? ` — Drg ${selectedDrawingNumber}` : ""}
                </th>
              </tr>
              <tr>
                <th className="ssr-th ssr-th--no">#</th>
                <th className="ssr-th">POC No</th>
                <th className="ssr-th">Drawing No</th>
                <th className="ssr-th">Drg Weight (kg)</th>
                <th className="ssr-th">Calc. Weight (kg)</th>
                <th className="ssr-th">Difference (kg)</th>
                <th className="ssr-th">Diff %</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row, idx) => {
                const diff = row.drgWeight - row.totalWeight;
                const diffClass = Math.abs(diff) < 0.001 ? "" : diff > 0 ? "ssr-diff-over" : "ssr-diff-under";
                const diffPercent = getDiffPercent(row.drgWeight, row.totalWeight);
                const diffPercentClass =
                  diffPercent === null || Math.abs(diffPercent) < 0.001
                    ? ""
                    : diffPercent > 0
                      ? "ssr-diff-over"
                      : "ssr-diff-under";
                return (
                  <tr className="ssr-row" key={`${row.pocNo}-${row.drawingNumber}`}>
                    <td className="ssr-td ssr-td--no">{idx + 1}</td>
                    <td className="ssr-td">{row.pocNo}</td>
                    <td className="ssr-td ssr-td--drg">{row.drawingNumber}</td>
                    <td className="ssr-td ssr-td--numeric">{fmt3(row.drgWeight)}</td>
                    <td className="ssr-td ssr-td--numeric">{fmt3(row.totalWeight)}</td>
                    <td className={`ssr-td ssr-td--numeric ${diffClass}`}>
                      {fmt3(Math.abs(diff))}
                      {Math.abs(diff) >= 0.001 && (
                        <span className="ssr-diff-indicator">{diff > 0 ? "▼" : "▲"}</span>
                      )}
                    </td>
                    <td className={`ssr-td ssr-td--numeric ${diffPercentClass}`}>
                      {fmtPercent(diffPercent)}
                    </td>
                  </tr>
                );
              })}
              <tr className="ssr-total-row">
                <td className="ssr-td"></td>
                <td className="ssr-td" colSpan={2} style={{ fontWeight: 700 }}>TOTAL</td>
                <td className="ssr-td ssr-td--numeric" style={{ fontWeight: 700 }}>{fmt3(grandTotals.drgWeight)}</td>
                <td className="ssr-td ssr-td--numeric" style={{ fontWeight: 700 }}>{fmt3(grandTotals.totalWeight)}</td>
                <td className="ssr-td ssr-td--numeric" style={{ fontWeight: 700 }}>
                  {fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))}
                </td>
                <td className="ssr-td ssr-td--numeric" style={{ fontWeight: 700 }}>
                  {fmtPercent(getDiffPercent(grandTotals.drgWeight, grandTotals.totalWeight))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .ssr-diff-over { color: #e74c3c; font-weight: 600; }
        .ssr-diff-under { color: #27ae60; font-weight: 600; }
        .ssr-diff-indicator { font-size: 10px; margin-left: 4px; }
        .ssr-total-row { background: #f8f9fa; border-top: 2px solid #ddd; }
      `}</style>
    </div>
  );
}