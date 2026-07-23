import { useState, useEffect, useMemo } from "react";
import { db, collection, getDocs } from "../../dataClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./AbstractReport.css";

export default function AbstractReport() {
  const [data, setData] = useState([]);
  const [searchPONo, setSearchPONo] = useState("");
  const [searchDrawingNumber, setSearchDrawingNumber] = useState("");
  const [searchPartName, setSearchPartName] = useState("");
  const [viewMode, setViewMode] = useState("section");
  const [expandedDrawings, setExpandedDrawings] = useState(new Set());
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [expandedOccurrences, setExpandedOccurrences] = useState(new Set());

  useEffect(() => {
    async function fetchData() {
      try {
        const snap = await getDocs(collection(db, "entries"));
        const rows = [];
        snap.docs.forEach((d) => {
          const entry = d.data();
          if (entry.items && Array.isArray(entry.items)) {
            entry.items.forEach((item) => {
              const toNum = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

              // Preserve the full size/designation string (e.g. "75*75*6")
              const sectionLabel = (item.section || item.designation || "").toString().trim();
              // sizeDisplay: use designation or size as a display string (not parsed to number)
              const sizeDisplay = (item.size || item.thickness || "").toString().trim();

              rows.push({
                poNo: entry.poNo || "",
                equipment: entry.equipment || "",
                partName: entry.partName || "",
                drawingNumber: entry.drawingNumber || "",
                pos: item.pos,
                quantity: toNum(item.quantity),
                section: sectionLabel,
                sizeDisplay: sizeDisplay,          // ← full string like "75*75*6"
                size: toNum(item.size ?? item.thickness ?? 0), // numeric fallback
                length: toNum(item.length),
                width: toNum(item.width),
                sectionalWeight: toNum(item.sectionalWeight ?? 0),
                singleWeight: toNum(item.singleWeight),
                drgWeight: toNum(item.drgWeight),
                totalWeight: toNum(item.totalWeight),
                isPlate: item.isPlate !== undefined ? item.isPlate : true,
              });
            });
          }
        });
        setData(rows);
      } catch (err) {
        console.error("Error fetching data:", err);
      }
    }
    fetchData();
  }, []);

  // ─── Cascading filter options ──────────────────────────────────────────────
  const poNoOptions = useMemo(
    () => [...new Set(data.map((r) => r.poNo).filter(Boolean))].sort(),
    [data]
  );

  const drawingNumberOptions = useMemo(() => {
    const source = searchPONo ? data.filter((r) => r.poNo === searchPONo) : data;
    return [...new Set(source.map((r) => r.drawingNumber).filter(Boolean))].sort();
  }, [data, searchPONo]);

  const partNameOptions = useMemo(() => {
    let source = data;
    if (searchPONo) source = source.filter((r) => r.poNo === searchPONo);
    if (searchDrawingNumber) source = source.filter((r) => r.drawingNumber === searchDrawingNumber);
    return [...new Set(source.map((r) => r.partName).filter(Boolean))].sort();
  }, [data, searchPONo, searchDrawingNumber]);

  // Item Desc: once POC No + Drawing No are both picked, auto-select the
  // Item Desc if only one is possible for that combination. Also clears
  // the current selection first if it's no longer valid — same behavior
  // as the View Data page.
  useEffect(() => {
    if (searchPartName && !partNameOptions.includes(searchPartName)) {
      setSearchPartName("");
      return;
    }
    if (searchPONo && searchDrawingNumber && !searchPartName && partNameOptions.length === 1) {
      setSearchPartName(partNameOptions[0]);
    }
  }, [searchPONo, searchDrawingNumber, searchPartName, partNameOptions]);

  const filteredRows = useMemo(() => {
    let result = [...data];
    if (searchPONo) result = result.filter((r) => r.poNo === searchPONo);
    if (searchDrawingNumber) result = result.filter((r) => r.drawingNumber === searchDrawingNumber);
    if (searchPartName) result = result.filter((r) => r.partName === searchPartName);
    return result;
  }, [data, searchPONo, searchDrawingNumber, searchPartName]);

  // Section-wise aggregation — each unique section+sizeDisplay gets its own row
  const sectionData = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      // Key by section name AND the full size string so 75*75*6 and 100*100*10 are separate
      const key = `${row.section || "Unknown"}__${row.sizeDisplay || row.size}`;
      if (!grouped[key]) {
        grouped[key] = {
          section: row.section || "Unknown",
          sizeDisplay: row.sizeDisplay || String(row.size),
          size: row.size,
          drgWeight: 0,
          totalWeight: 0,
          totalQty: 0,
        };
      }
      grouped[key].drgWeight += row.drgWeight;
      grouped[key].totalWeight += row.totalWeight;
      grouped[key].totalQty += row.quantity;
    });
    return Object.values(grouped).sort((a, b) => {
      const sectionCmp = a.section.localeCompare(b.section);
      if (sectionCmp !== 0) return sectionCmp;
      return a.sizeDisplay.localeCompare(b.sizeDisplay);
    });
  }, [filteredRows]);

  // Drawing Abs aggregation (with nested section breakdown)
  const drawingData = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      const key = row.drawingNumber || "Unknown";
      if (!grouped[key]) {
        grouped[key] = {
          drawingNumber: key,
          partName: row.partName,
          drgWeight: 0,
          totalWeight: 0,
          totalQty: 0,
          sections: {},
        };
      }
      grouped[key].drgWeight += row.drgWeight;
      grouped[key].totalWeight += row.totalWeight;
      grouped[key].totalQty += row.quantity;

      // Also key nested sections by full size string
      const secKey = `${row.section || "Unknown"}__${row.sizeDisplay || row.size}`;
      if (!grouped[key].sections[secKey]) {
        grouped[key].sections[secKey] = {
          section: row.section || "Unknown",
          sizeDisplay: row.sizeDisplay || String(row.size),
          size: row.size,
          totalQty: 0,
          drgWeight: 0,
          totalWeight: 0,
        };
      }
      grouped[key].sections[secKey].totalQty += row.quantity;
      grouped[key].sections[secKey].drgWeight += row.drgWeight;
      grouped[key].sections[secKey].totalWeight += row.totalWeight;
    });

    return Object.values(grouped)
      .sort((a, b) => a.drawingNumber.localeCompare(b.drawingNumber))
      .map((d) => ({
        ...d,
        sections: Object.values(d.sections).sort((a, b) => {
          const cmp = a.section.localeCompare(b.section);
          if (cmp !== 0) return cmp;
          return a.sizeDisplay.localeCompare(b.sizeDisplay);
        }),
      }));
  }, [filteredRows]);

  // For every section+size, where does it occur — restricted to the SAME
  // filter criteria currently applied above (POC No / Drawing Number / Item
  // Desc). Used to expand a section-wise row and show its occurrences.
  const sectionOccurrencesAll = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      const key = `${row.section || "Unknown"}__${row.sizeDisplay || row.size}`;
      if (!grouped[key]) grouped[key] = {};
      const subKey = `${row.poNo || "—"}__${row.drawingNumber || "Unknown"}__${row.partName || "—"}`;
      if (!grouped[key][subKey]) {
        grouped[key][subKey] = {
          poNo: row.poNo || "—",
          drawingNumber: row.drawingNumber || "Unknown",
          partName: row.partName || "—",
          totalQty: 0,
          drgWeight: 0,
          totalWeight: 0,
        };
      }
      grouped[key][subKey].totalQty += row.quantity;
      grouped[key][subKey].drgWeight += row.drgWeight;
      grouped[key][subKey].totalWeight += row.totalWeight;
    });

    const result = {};
    Object.entries(grouped).forEach(([key, subMap]) => {
      result[key] = Object.values(subMap).sort((a, b) => {
        const poCmp = a.poNo.localeCompare(b.poNo);
        if (poCmp !== 0) return poCmp;
        return a.drawingNumber.localeCompare(b.drawingNumber);
      });
    });
    return result;
  }, [filteredRows]);

  const grandTotals = useMemo(() => {
    if (viewMode === "section") {
      return {
        drgWeight: sectionData.reduce((s, x) => s + x.drgWeight, 0),
        totalWeight: sectionData.reduce((s, x) => s + x.totalWeight, 0),
        totalQty: sectionData.reduce((s, x) => s + x.totalQty, 0),
      };
    } else {
      return {
        drgWeight: drawingData.reduce((s, x) => s + x.drgWeight, 0),
        totalWeight: drawingData.reduce((s, x) => s + x.totalWeight, 0),
        totalQty: drawingData.reduce((s, x) => s + x.totalQty, 0),
      };
    }
  }, [viewMode, sectionData, drawingData]);

  const fmt3 = (v) => { const n = Number(v); return isNaN(n) ? "0.0" : n.toFixed(1); };
  const fmtComma = (v) => { const n = Number(v); return isNaN(n) ? "0" : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }); };

  // ─── Difference % helper (used to decide when to highlight a row/cell, and
  // now also displayed directly in its own "Diff %" column) ─────────────────
  const diffPercent = (drg, calc) => {
    const d = Number(drg) || 0;
    const c = Number(calc) || 0;
    if (d === 0 && c === 0) return 0;
    if (d === 0) return 100; // no drg weight to compare against, but a calc value exists
    return (Math.abs(d - c) / Math.abs(d)) * 100;
  };
  const fmtPct = (drg, calc) => `${diffPercent(drg, calc).toFixed(1)}%`;

  const summaryLine = `POC No: ${searchPONo || "All"}    Drawing No: ${searchDrawingNumber || "All"}    Description: ${searchPartName || "All"}`;

  // When a Drawing Number filter is active, there's only one drawing being
  // shown, so the Drawing Number column is redundant and hidden. When no
  // drawing filter is chosen, show the column so every drawing is identifiable.
  const showDrawingCol = !searchDrawingNumber;

  // Same logic for Item Desc — only show the column when no Item Desc
  // filter is active (i.e. multiple descriptions could be present).
  const showPartNameCol = !searchPartName;

  // Number of "identifier" columns (Drawing Number / Item Desc) currently shown,
  // used to keep colSpans correct in the Drawing Abs table.
  const drawingIdColCount = (showDrawingCol ? 1 : 0) + (showPartNameCol ? 1 : 0);

  const toggleDrawing = (drawingNumber) => {
    setExpandedDrawings((prev) => {
      const next = new Set(prev);
      if (next.has(drawingNumber)) next.delete(drawingNumber);
      else next.add(drawingNumber);
      return next;
    });
  };

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  const toggleOccurrence = (occKey) => {
    setExpandedOccurrences((prev) => {
      const next = new Set(prev);
      if (next.has(occKey)) next.delete(occKey);
      else next.add(occKey);
      return next;
    });
  };

  // All individual item rows for a given POC + Drawing + Part combination,
  // restricted to the same section + size that was expanded at the top level,
  // AND to the current filter criteria (POC No / Drawing Number / Item Desc)
  // selected above the table.
  const getItemsForOccurrence = (poNo, drawingNumber, partName, section, sizeDisplay) => {
    return filteredRows
      .filter(
        (r) =>
          (r.poNo || "—") === poNo &&
          (r.drawingNumber || "Unknown") === drawingNumber &&
          (r.partName || "—") === partName &&
          (r.section || "Unknown") === section &&
          (r.sizeDisplay || String(r.size)) === sizeDisplay
      )
      .sort((a, b) => (a.pos || 0) - (b.pos || 0));
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("SIEC-BOQ — Abstract Report", 40, 35);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    doc.text(summaryLine, 40, 52);
    doc.text(`View: ${viewMode === "section" ? "Section-wise" : "Drawing Abs"}`, 40, 65);

    if (viewMode === "section") {
      const body = sectionData.map((row, i) => [
        i + 1,
        row.section,
        row.sizeDisplay,   // ← full size string in PDF
        fmt3(row.drgWeight),
        fmt3(row.totalWeight),
        fmt3(Math.abs(row.drgWeight - row.totalWeight)),
        fmtPct(row.drgWeight, row.totalWeight),
      ]);
      body.push([
        "",
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
        "",
        { content: fmt3(grandTotals.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight)), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmtPct(grandTotals.drgWeight, grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
      ]);
      autoTable(doc, {
        startY: 80,
        head: [["S.No", "Section", "Size", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Diff %"]],
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center", cellWidth: 30 },
          1: { halign: "left" },
          2: { halign: "left" },   // size is now text, left-align
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
        },
      });
    } else {
      // Column layout differs depending on whether the Drawing Number and/or
      // Item Desc columns are shown (i.e. whether those filters are active).
      const idHeaders = [
        ...(showDrawingCol ? ["Drawing Number"] : []),
        ...(showPartNameCol ? ["Item Desc"] : []),
      ];
      const head = idHeaders.length
        ? [["S.No", ...idHeaders, "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Diff %"]]
        : [["S.No / Section", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Diff %"]];

      const body = [];
      drawingData.forEach((row, i) => {
        const mainRow = [
          { content: i + 1, styles: { fontStyle: "bold" } },
        ];
        if (showDrawingCol) {
          mainRow.push({ content: row.drawingNumber, styles: { fontStyle: "bold" } });
        }
        if (showPartNameCol) {
          mainRow.push({ content: row.partName || "—", styles: { fontStyle: "bold" } });
        }
        mainRow.push(
          { content: fmt3(row.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
          { content: fmt3(row.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
          { content: fmt3(Math.abs(row.drgWeight - row.totalWeight)), styles: { fontStyle: "bold", halign: "right" } },
          { content: fmtPct(row.drgWeight, row.totalWeight), styles: { fontStyle: "bold", halign: "right" } }
        );
        body.push(mainRow);

        row.sections.forEach((sec, si) => {
          const secRow = [
            { content: `  ${si + 1}. ${sec.section} (Size: ${sec.sizeDisplay})`, styles: { textColor: [100, 100, 100], fontSize: 7.5 } },
          ];
          if (showDrawingCol) {
            secRow.push({ content: "", styles: { textColor: [100, 100, 100] } });
          }
          if (showPartNameCol) {
            secRow.push({ content: "", styles: { textColor: [100, 100, 100] } });
          }
          secRow.push(
            { content: fmt3(sec.drgWeight), styles: { halign: "right", textColor: [100, 100, 100] } },
            { content: fmt3(sec.totalWeight), styles: { halign: "right", textColor: [100, 100, 100] } },
            { content: fmt3(Math.abs(sec.drgWeight - sec.totalWeight)), styles: { halign: "right", textColor: [100, 100, 100] } },
            { content: fmtPct(sec.drgWeight, sec.totalWeight), styles: { halign: "right", textColor: [100, 100, 100] } }
          );
          body.push(secRow);
        });
      });

      const totalRow = [
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
      ];
      if (showDrawingCol) {
        totalRow.push({ content: "", styles: { fontStyle: "bold" } });
      }
      if (showPartNameCol) {
        totalRow.push({ content: "", styles: { fontStyle: "bold" } });
      }
      totalRow.push(
        { content: fmt3(grandTotals.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight)), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmtPct(grandTotals.drgWeight, grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } }
      );
      body.push(totalRow);

      // Build columnStyles dynamically: col 0 is always left-aligned (S.No),
      // each identifier column is left-aligned, remaining numeric columns
      // are right-aligned.
      const columnStyles = { 0: { halign: "left" } };
      let colIdx = 1;
      idHeaders.forEach(() => {
        columnStyles[colIdx] = { halign: "left" };
        colIdx += 1;
      });
      for (let k = 0; k < 4; k += 1) {
        columnStyles[colIdx] = { halign: "right" };
        colIdx += 1;
      }

      autoTable(doc, {
        startY: 80,
        head,
        body,
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles,
      });
    }
    doc.save("Abstract_Report_BOQ.pdf");
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [];
    wsData.push(["SIEC-BOQ — Abstract Report"]);
    wsData.push([summaryLine]);
    wsData.push([`View: ${viewMode === "section" ? "Section-wise" : "Drawing Abs"}`]);
    wsData.push([]);

    if (viewMode === "section") {
      wsData.push(["S.No", "Section", "Size", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Diff %"]);
      sectionData.forEach((row, i) => {
        wsData.push([
          i + 1,
          row.section,
          row.sizeDisplay,   // ← full size string in Excel
          Number(fmt3(row.drgWeight)),
          Number(fmt3(row.totalWeight)),
          Number(fmt3(Math.abs(row.drgWeight - row.totalWeight))),
          fmtPct(row.drgWeight, row.totalWeight),
        ]);
      });
      wsData.push([
        "TOTAL", "", "",
        Number(fmt3(grandTotals.drgWeight)),
        Number(fmt3(grandTotals.totalWeight)),
        Number(fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))),
        fmtPct(grandTotals.drgWeight, grandTotals.totalWeight),
      ]);
    } else {
      const idHeaders = [
        ...(showDrawingCol ? ["Drawing Number"] : []),
        ...(showPartNameCol ? ["Item Desc"] : []),
      ];
      const idBlanks = idHeaders.map(() => "");

      if (idHeaders.length) {
        wsData.push(["S.No", ...idHeaders, "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Diff %"]);
        drawingData.forEach((row, i) => {
          const diff = Math.abs(row.drgWeight - row.totalWeight);
          const idValues = [
            ...(showDrawingCol ? [row.drawingNumber] : []),
            ...(showPartNameCol ? [row.partName || "—"] : []),
          ];
          wsData.push([
            i + 1,
            ...idValues,
            Number(fmt3(row.drgWeight)), Number(fmt3(row.totalWeight)), Number(fmt3(diff)),
            fmtPct(row.drgWeight, row.totalWeight),
          ]);
          row.sections.forEach((sec) => {
            const secDiff = Math.abs(sec.drgWeight - sec.totalWeight);
            wsData.push([
              `  ↳ ${sec.section} (Size: ${sec.sizeDisplay})`,
              ...idBlanks,
              Number(fmt3(sec.drgWeight)), Number(fmt3(sec.totalWeight)), Number(fmt3(secDiff)),
              fmtPct(sec.drgWeight, sec.totalWeight),
            ]);
          });
        });
        wsData.push([
          "TOTAL",
          ...idBlanks,
          Number(fmt3(grandTotals.drgWeight)), Number(fmt3(grandTotals.totalWeight)),
          Number(fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))),
          fmtPct(grandTotals.drgWeight, grandTotals.totalWeight),
        ]);
      } else {
        wsData.push(["S.No / Section", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Diff %"]);
        drawingData.forEach((row, i) => {
          const diff = Math.abs(row.drgWeight - row.totalWeight);
          wsData.push([
            i + 1,
            Number(fmt3(row.drgWeight)), Number(fmt3(row.totalWeight)), Number(fmt3(diff)),
            fmtPct(row.drgWeight, row.totalWeight),
          ]);
          row.sections.forEach((sec) => {
            const secDiff = Math.abs(sec.drgWeight - sec.totalWeight);
            wsData.push([
              `  ↳ ${sec.section} (Size: ${sec.sizeDisplay})`,
              Number(fmt3(sec.drgWeight)), Number(fmt3(sec.totalWeight)), Number(fmt3(secDiff)),
              fmtPct(sec.drgWeight, sec.totalWeight),
            ]);
          });
        });
        wsData.push([
          "TOTAL",
          Number(fmt3(grandTotals.drgWeight)), Number(fmt3(grandTotals.totalWeight)),
          Number(fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))),
          fmtPct(grandTotals.drgWeight, grandTotals.totalWeight),
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = Array(12).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws, "Abstract Report");
    XLSX.writeFile(wb, "Abstract_Report_BOQ.xlsx");
  };

  const clearFilters = () => {
    setSearchPONo("");
    setSearchDrawingNumber("");
    setSearchPartName("");
  };
  const hasFilter = searchPONo || searchDrawingNumber || searchPartName;

  return (
    <div className="abstract-container">
      <h1 className="abstract-heading">Abstract Report — Section-wise Breakup</h1>

      <div className="filter-container">
        <div className="filter-row">
          <div className="filter-group">
            <label>POC No:</label>
            <select
              className="filter-select"
              value={searchPONo}
              onChange={(e) => {
                setSearchPONo(e.target.value);
                setSearchDrawingNumber("");
                setSearchPartName("");
              }}
            >
              <option value="">All POC Nos</option>
              {poNoOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <label>Drawing Number:</label>
            <select
              className="filter-select"
              value={searchDrawingNumber}
              onChange={(e) => {
                setSearchDrawingNumber(e.target.value);
                setSearchPartName("");
              }}
            >
              <option value="">All Drawing Numbers</option>
              {drawingNumberOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <label>Item Desc:</label>
            <select className="filter-select" value={searchPartName} onChange={(e) => setSearchPartName(e.target.value)}>
              <option value="">All Descriptions</option>
              {partNameOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <label>View By:</label>
            <select className="filter-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
              <option value="section">Section-wise</option>
              <option value="drawing">Drawing Abs</option>
            </select>
          </div>
        </div>

        <div className="button-row">
          {hasFilter && <button className="btn-clear" onClick={clearFilters}>Clear Filters</button>}
          <button className="btn-export btn-pdf" onClick={exportPDF}>Export PDF</button>
          <button className="btn-export btn-excel" onClick={exportExcel}>Export Excel</button>
        </div>
      </div>

      <div className="summary-box">
        <span><strong>POC No:</strong> {searchPONo || "All"}</span>
        <span><strong>Drawing No:</strong> {searchDrawingNumber || "All"}</span>
        <span><strong>Item Desc:</strong> {searchPartName || "All"}</span>
        <span><strong>Total Items:</strong> {viewMode === "section" ? sectionData.length : drawingData.length}</span>
        <span><strong>Total Weight:</strong> {fmtComma(grandTotals.totalWeight)} kg</span>
      </div>

      <div className="table-wrapper">
        {viewMode === "section" ? (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={8} className="table-title">
                  Section-wise Abstract{searchPONo && ` — POC: ${searchPONo}`}{searchDrawingNumber && ` — Drg: ${searchDrawingNumber}`}{searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th style={{ width: "36px" }}></th>
                <th>S.No</th>
                <th>Section</th>
                <th>Size</th>
                <th>Drg Weight (Kg)</th>
                <th>Calc. Weight (kg)</th>
                <th>Difference</th>
                <th>Diff %</th>
              </tr>
            </thead>
            <tbody>
              {sectionData.length === 0 ? (
                <tr><td colSpan={8} className="empty-cell">No data found. Add entries from the Entry Page!</td></tr>
              ) : (
                sectionData.map((row, i) => {
                  const diff = row.drgWeight - row.totalWeight;
                  const diffClass = Math.abs(diff) < 0.1 ? "" : diff > 0 ? "diff-over" : "diff-under";
                  const sectionKey = `${row.section}__${row.sizeDisplay}`;
                  const isExpanded = expandedSections.has(sectionKey);
                  const occurrences = sectionOccurrencesAll[sectionKey] || [];

                  return (
                    <>
                      <tr
                        key={sectionKey}
                        style={{ background: "#f8f9fa", cursor: "pointer" }}
                        onClick={() => toggleSection(sectionKey)}
                      >
                        <td style={{ textAlign: "center", fontSize: "13px", color: "#2980b9", userSelect: "none" }}>
                          {isExpanded ? "▼" : "▶"}
                        </td>
                        <td>{i + 1}</td>
                        <td className="text-left">{row.section}</td>
                        <td className="text-left">{row.sizeDisplay}</td>
                        <td className="numeric-cell">{fmt3(row.drgWeight)}</td>
                        <td className="numeric-cell">{fmt3(row.totalWeight)}</td>
                        <td className={`numeric-cell ${diffClass}`}>
                          {fmt3(Math.abs(diff))}
                          {Math.abs(diff) >= 0.1 && (
                            <span className="diff-indicator">{diff > 0 ? "▼" : "▲"}</span>
                          )}
                        </td>
                        <td className={`numeric-cell ${diffClass}`}>{fmtPct(row.drgWeight, row.totalWeight)}</td>
                      </tr>

                      {isExpanded && (
                        occurrences.length === 0 ? (
                          <tr key={`${sectionKey}-none`} style={{ background: "#eef4fb" }}>
                            <td></td>
                            <td colSpan={7} style={{ color: "#888", fontSize: "12px", paddingLeft: "16px" }}>
                              No occurrences found across the data.
                            </td>
                          </tr>
                        ) : (
                          occurrences.map((occ, oi) => {
                            const occKey = `${sectionKey}::${occ.poNo}__${occ.drawingNumber}__${occ.partName}`;
                            const isOccExpanded = expandedOccurrences.has(occKey);
                            const occItems = isOccExpanded
                              ? getItemsForOccurrence(occ.poNo, occ.drawingNumber, occ.partName, row.section, row.sizeDisplay)
                              : [];

                            // Difference for this occurrence row (replaces the old "Qty: 60" display)
                            const occDiff = occ.drgWeight - occ.totalWeight;
                            const occDiffClass = Math.abs(occDiff) < 0.1 ? "" : occDiff > 0 ? "diff-over" : "diff-under";

                            return (
                              <>
                                <tr
                                  key={`${sectionKey}-occ-${oi}`}
                                  style={{ background: "#eef4fb", cursor: "pointer" }}
                                  onClick={() => toggleOccurrence(occKey)}
                                >
                                  <td></td>
                                  <td style={{ color: "#7f8c8d", fontSize: "12px", paddingLeft: "16px" }}>
                                    <span style={{ color: "#2980b9", marginRight: "4px" }}>{isOccExpanded ? "▼" : "▶"}</span>
                                    {oi + 1}
                                  </td>
                                  <td style={{ color: "#555", fontSize: "12px" }} colSpan={2}>
                                    POC: {occ.poNo} &nbsp;|&nbsp; Drg: {occ.drawingNumber} &nbsp;|&nbsp; Part: {occ.partName}
                                  </td>
                                  <td className="numeric-cell" style={{ color: "#555", fontSize: "12px" }}>{fmt3(occ.drgWeight)}</td>
                                  <td className="numeric-cell" style={{ color: "#555", fontSize: "12px" }}>{fmt3(occ.totalWeight)}</td>
                                  <td className={`numeric-cell ${occDiffClass}`} style={{ fontSize: "12px" }}>
                                    {fmt3(Math.abs(occDiff))}
                                    {Math.abs(occDiff) >= 0.1 && (
                                      <span className="diff-indicator">{occDiff > 0 ? "▼" : "▲"}</span>
                                    )}
                                  </td>
                                  <td className={`numeric-cell ${occDiffClass}`} style={{ fontSize: "12px" }}>
                                    {fmtPct(occ.drgWeight, occ.totalWeight)}
                                  </td>
                                </tr>

                                {isOccExpanded && (
                                  <tr key={`${occKey}-items`} style={{ background: "#ffffff" }}>
                                    <td></td>
                                    <td colSpan={7} style={{ padding: "6px 8px 12px 32px" }}>
                                      <table
                                        style={{
                                          width: "100%",
                                          fontSize: "11.5px",
                                          borderCollapse: "collapse",
                                          border: "1px solid #dfe6ec",
                                        }}
                                      >
                                        <thead>
                                          <tr style={{ background: "#f1f5f9" }}>
                                            <th style={{ padding: "4px 6px", textAlign: "center", border: "1px solid #dfe6ec" }}>POS</th>
                                            <th style={{ padding: "4px 6px", textAlign: "left", border: "1px solid #dfe6ec" }}>Section</th>
                                            <th style={{ padding: "4px 6px", textAlign: "left", border: "1px solid #dfe6ec" }}>Size</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Qty</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Length</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Width</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Drg Wt (kg)</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Calc Wt (kg)</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Difference</th>
                                            <th style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>Diff %</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {occItems.length === 0 ? (
                                            <tr>
                                              <td colSpan={10} style={{ padding: "6px", textAlign: "center", color: "#888", border: "1px solid #dfe6ec" }}>
                                                No items found.
                                              </td>
                                            </tr>
                                          ) : (
                                            occItems.map((it, ii) => {
                                              const itemDiff = it.drgWeight - it.totalWeight;
                                              const itemPct = diffPercent(it.drgWeight, it.totalWeight);
                                              const isHighRow = itemPct > 6;
                                              return (
                                                <tr
                                                  key={`${occKey}-item-${ii}`}
                                                  className={isHighRow ? "diff-highlight-row" : ""}
                                                >
                                                  <td style={{ padding: "4px 6px", textAlign: "center", border: "1px solid #dfe6ec" }}>{it.pos}</td>
                                                  <td style={{ padding: "4px 6px", border: "1px solid #dfe6ec" }}>{it.section || "—"}</td>
                                                  <td style={{ padding: "4px 6px", border: "1px solid #dfe6ec" }}>{it.sizeDisplay || "—"}</td>
                                                  <td style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>{it.quantity}</td>
                                                  <td style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>{it.length || "—"}</td>
                                                  <td style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>{it.width || "—"}</td>
                                                  <td style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>{fmt3(it.drgWeight)}</td>
                                                  <td style={{ padding: "4px 6px", textAlign: "right", border: "1px solid #dfe6ec" }}>{fmt3(it.totalWeight)}</td>
                                                  <td
                                                    className={isHighRow ? "diff-cell-highlight" : ""}
                                                    style={{
                                                      padding: "4px 6px",
                                                      textAlign: "right",
                                                      border: "1px solid #dfe6ec",
                                                      fontWeight: isHighRow ? 700 : 400,
                                                    }}
                                                  >
                                                    {fmt3(Math.abs(itemDiff))}
                                                  </td>
                                                  <td
                                                    className={isHighRow ? "diff-cell-highlight" : ""}
                                                    style={{
                                                      padding: "4px 6px",
                                                      textAlign: "right",
                                                      border: "1px solid #dfe6ec",
                                                      fontWeight: isHighRow ? 700 : 400,
                                                    }}
                                                  >
                                                    {itemPct.toFixed(1)}%
                                                  </td>
                                                </tr>
                                              );
                                            })
                                          )}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })
                        )
                      )}
                    </>
                  );
                })
              )}
              <tr className="total-row">
                <td></td>
                <td colSpan={3} style={{ textAlign: "center" }}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.drgWeight)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
                <td className="numeric-cell">{fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))}</td>
                <td className="numeric-cell">{fmtPct(grandTotals.drgWeight, grandTotals.totalWeight)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={6 + drawingIdColCount} className="table-title">
                  Drawing Abs{searchPONo && ` — POC: ${searchPONo}`}{searchDrawingNumber && ` — Drg: ${searchDrawingNumber}`}{searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th style={{ width: "36px" }}></th>
                <th>S.No</th>
                {showDrawingCol && <th>Drawing Number</th>}
                {showPartNameCol && <th>Item Desc</th>}
                <th>Drg Weight (Kg)</th>
                <th>Calc. Weight (kg)</th>
                <th>Difference</th>
                <th>Diff %</th>
              </tr>
            </thead>
            <tbody>
              {drawingData.length === 0 ? (
                <tr><td colSpan={6 + drawingIdColCount} className="empty-cell">No data found. Add entries from the Entry Page!</td></tr>
              ) : (
                drawingData.map((row, i) => {
                  const diff = row.drgWeight - row.totalWeight;
                  const diffClass = Math.abs(diff) < 0.1 ? "" : diff > 0 ? "diff-over" : "diff-under";
                  const isExpanded = expandedDrawings.has(row.drawingNumber);

                  return (
                    <>
                      <tr key={row.drawingNumber} style={{ background: "#f8f9fa", cursor: "pointer" }} onClick={() => toggleDrawing(row.drawingNumber)}>
                        <td style={{ textAlign: "center", fontSize: "13px", color: "#2980b9", userSelect: "none" }}>
                          {isExpanded ? "▼" : "▶"}
                        </td>
                        <td style={{ fontWeight: 600 }}>{i + 1}</td>
                        {showDrawingCol && (
                          <td className="text-left" style={{ fontWeight: 600 }}>{row.drawingNumber}</td>
                        )}
                        {showPartNameCol && (
                          <td className="text-left" style={{ fontWeight: 600 }}>{row.partName || "—"}</td>
                        )}
                        <td className="numeric-cell" style={{ fontWeight: 600 }}>{fmt3(row.drgWeight)}</td>
                        <td className="numeric-cell" style={{ fontWeight: 600 }}>{fmt3(row.totalWeight)}</td>
                        <td className={`numeric-cell ${diffClass}`} style={{ fontWeight: 600 }}>
                          {fmt3(Math.abs(diff))}
                          {Math.abs(diff) >= 0.1 && (
                            <span className="diff-indicator">{diff > 0 ? "▼" : "▲"}</span>
                          )}
                        </td>
                        <td className={`numeric-cell ${diffClass}`} style={{ fontWeight: 600 }}>
                          {fmtPct(row.drgWeight, row.totalWeight)}
                        </td>
                      </tr>

                      {isExpanded && row.sections.map((sec, si) => {
                        const secDiff = sec.drgWeight - sec.totalWeight;
                        const secPct = diffPercent(sec.drgWeight, sec.totalWeight);
                        const secIsHigh = secPct > 6;
                        const secDiffClass = Math.abs(secDiff) < 0.1 ? "" : secDiff > 0 ? "diff-over" : "diff-under";
                        return (
                          <tr
                            key={`${row.drawingNumber}-sec-${si}`}
                            className={secIsHigh ? "diff-highlight-row" : ""}
                            style={{ background: secIsHigh ? undefined : "#eef4fb" }}
                          >
                            <td></td>
                            <td style={{ color: "#555", fontSize: "12px", paddingLeft: "16px" }}>
                              <span style={{ color: "#2980b9", marginRight: "6px" }}>↳</span>
                              {si + 1}. {sec.section}
                              <span style={{ color: "#888", fontSize: "11px", marginLeft: "6px" }}>
                                (Size: {sec.sizeDisplay})
                              </span>
                            </td>
                            {showDrawingCol && <td></td>}
                            {showPartNameCol && <td></td>}
                            <td className="numeric-cell" style={{ color: "#555", fontSize: "12px" }}>{fmt3(sec.drgWeight)}</td>
                            <td className="numeric-cell" style={{ color: "#555", fontSize: "12px" }}>{fmt3(sec.totalWeight)}</td>
                            <td
                              className={`numeric-cell ${secDiffClass} ${secIsHigh ? "diff-cell-highlight" : ""}`}
                              style={{ fontSize: "12px", fontWeight: secIsHigh ? 700 : 600 }}
                            >
                              {fmt3(Math.abs(secDiff))}
                              {Math.abs(secDiff) >= 0.1 && (
                                <span className="diff-indicator">{secDiff > 0 ? "▼" : "▲"}</span>
                              )}
                            </td>
                            <td
                              className={`numeric-cell ${secDiffClass} ${secIsHigh ? "diff-cell-highlight" : ""}`}
                              style={{ fontSize: "12px", fontWeight: secIsHigh ? 700 : 600 }}
                            >
                              {secPct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })
              )}
              <tr className="total-row">
                <td></td>
                <td colSpan={1 + drawingIdColCount}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.drgWeight)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
                <td className="numeric-cell">{fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))}</td>
                <td className="numeric-cell">{fmtPct(grandTotals.drgWeight, grandTotals.totalWeight)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .diff-over { color: #e74c3c; font-weight: 600; }
        .diff-under { color: #27ae60; font-weight: 600; }
        .diff-indicator { font-size: 10px; margin-left: 4px; }
        .diff-highlight-row { background-color: #fff3cd; }
        .diff-cell-highlight { background-color: #ffe08a; color: #7a4a00; }
      `}</style>
    </div>
  );
}