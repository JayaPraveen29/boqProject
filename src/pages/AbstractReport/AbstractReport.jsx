import { useState, useEffect, useMemo } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./AbstractReport.css";

export default function AbstractReport() {
  const [data, setData] = useState([]);
  const [searchPONo, setSearchPONo] = useState("");
  const [searchPartName, setSearchPartName] = useState("");
  const [viewMode, setViewMode] = useState("section");
  const [expandedDrawings, setExpandedDrawings] = useState(new Set());

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

  const poNoOptions = useMemo(() => [...new Set(data.map((r) => r.poNo).filter(Boolean))].sort(), [data]);
  const partNameOptions = useMemo(() => {
  const source = searchPONo ? data.filter((r) => r.poNo === searchPONo) : data;
  return [...new Set(source.map((r) => r.partName).filter(Boolean))].sort();
  }, [data, searchPONo]);

  const filteredRows = useMemo(() => {
    let result = [...data];
    if (searchPONo) result = result.filter((r) => r.poNo === searchPONo);
    if (searchPartName) result = result.filter((r) => r.partName === searchPartName);
    return result;
  }, [data, searchPONo, searchPartName]);

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

  // Drawing-wise aggregation (with nested section breakdown)
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
  const summaryLine = `POC No: ${searchPONo || "All"}    Description: ${searchPartName || "All"}`;

  const toggleDrawing = (drawingNumber) => {
    setExpandedDrawings((prev) => {
      const next = new Set(prev);
      if (next.has(drawingNumber)) next.delete(drawingNumber);
      else next.add(drawingNumber);
      return next;
    });
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("SIEC-BOQ — Abstract Report", 40, 35);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    doc.text(summaryLine, 40, 52);
    doc.text(`View: ${viewMode === "section" ? "Section-wise" : "Drawing-wise"}`, 40, 65);

    if (viewMode === "section") {
      const body = sectionData.map((row, i) => [
        i + 1,
        row.section,
        row.sizeDisplay,   // ← full size string in PDF
        fmt3(row.drgWeight),
        fmt3(row.totalWeight),
        fmt3(Math.abs(row.drgWeight - row.totalWeight)),
      ]);
      body.push([
        "",
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
        "",
        { content: fmt3(grandTotals.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight)), styles: { fontStyle: "bold", halign: "right" } },
      ]);
      autoTable(doc, {
        startY: 80,
        head: [["S.No", "Section", "Size", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]],
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
        },
      });
    } else {
      const body = [];
      drawingData.forEach((row, i) => {
        body.push([
          { content: i + 1, styles: { fontStyle: "bold" } },
          { content: row.drawingNumber, styles: { fontStyle: "bold" } },
          { content: row.partName, styles: { fontStyle: "bold" } },
          { content: fmt3(row.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
          { content: fmt3(row.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
          { content: fmt3(Math.abs(row.drgWeight - row.totalWeight)), styles: { fontStyle: "bold", halign: "right" } },
        ]);
        row.sections.forEach((sec, si) => {
          body.push([
            "",
            { content: `  ${si + 1}.`, styles: { textColor: [100, 100, 100] } },
            { content: sec.section, styles: { textColor: [100, 100, 100] } },
            { content: fmt3(sec.drgWeight), styles: { halign: "right", textColor: [100, 100, 100] } },
            { content: fmt3(sec.totalWeight), styles: { halign: "right", textColor: [100, 100, 100] } },
            { content: `Size: ${sec.sizeDisplay}`, styles: { textColor: [100, 100, 100], fontSize: 7 } },
          ]);
        });
      });
      body.push([
        "",
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
        "",
        { content: fmt3(grandTotals.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
        "",
      ]);
      autoTable(doc, {
        startY: 80,
        head: [["S.No", "Drawing No", "Part Name / Section", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]],
        body,
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center", cellWidth: 28 },
          1: { halign: "left" },
          2: { halign: "left" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
      });
    }
    doc.save("Abstract_Report_BOQ.pdf");
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [];
    wsData.push(["SIEC-BOQ — Abstract Report"]);
    wsData.push([summaryLine]);
    wsData.push([`View: ${viewMode === "section" ? "Section-wise" : "Drawing-wise"}`]);
    wsData.push([]);

    if (viewMode === "section") {
      wsData.push(["S.No", "Section", "Size", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]);
      sectionData.forEach((row, i) => {
        wsData.push([
          i + 1,
          row.section,
          row.sizeDisplay,   // ← full size string in Excel
          Number(fmt3(row.drgWeight)),
          Number(fmt3(row.totalWeight)),
          Number(fmt3(Math.abs(row.drgWeight - row.totalWeight))),
        ]);
      });
      wsData.push(["TOTAL", "", "", Number(fmt3(grandTotals.drgWeight)), Number(fmt3(grandTotals.totalWeight)), Number(fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight)))]);
    } else {
      wsData.push(["S.No", "Drawing No", "Part Name", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference", "Section", "Size", "Sec Drg Wt", "Sec Calc Wt"]);
      drawingData.forEach((row, i) => {
        const diff = Math.abs(row.drgWeight - row.totalWeight);
        wsData.push([i + 1, row.drawingNumber, row.partName, Number(fmt3(row.drgWeight)), Number(fmt3(row.totalWeight)), Number(fmt3(diff)), "", "", "", ""]);
        row.sections.forEach((sec) => {
          wsData.push(["", "", `  ↳ ${sec.section}`, "", "", "", sec.section, sec.sizeDisplay, Number(fmt3(sec.drgWeight)), Number(fmt3(sec.totalWeight))]);
        });
      });
      wsData.push(["TOTAL", "", "", Number(fmt3(grandTotals.drgWeight)), Number(fmt3(grandTotals.totalWeight)), "", "", "", "", ""]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = Array(10).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws, "Abstract Report");
    XLSX.writeFile(wb, "Abstract_Report_BOQ.xlsx");
  };

  const clearFilters = () => { setSearchPONo(""); setSearchPartName(""); };
  const hasFilter = searchPONo || searchPartName;

  return (
    <div className="abstract-container">
      <h1 className="abstract-heading">Abstract Report — Section-wise Breakup</h1>

      <div className="filter-container">
        <div className="filter-row">
          <div className="filter-group">
            <label>POC No:</label>
            <select className="filter-select" value={searchPONo} onChange={(e) => { setSearchPONo(e.target.value); setSearchPartName(""); }}>
              <option value="">All POC Nos</option>
              {poNoOptions.map((p) => <option key={p} value={p}>{p}</option>)}
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
              <option value="drawing">Drawing-wise</option>
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
        <span><strong>Item Desc:</strong> {searchPartName || "All"}</span>
        <span><strong>Total Items:</strong> {viewMode === "section" ? sectionData.length : drawingData.length}</span>
        <span><strong>Total Weight:</strong> {fmtComma(grandTotals.totalWeight)} kg</span>
      </div>

      <div className="table-wrapper">
        {viewMode === "section" ? (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={6} className="table-title">
                  Section-wise Abstract{searchPONo && ` — POC: ${searchPONo}`}{searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th>S.No</th>
                <th>Section</th>
                <th>Size</th>
                <th>Drg Weight (Kg)</th>
                <th>Calc. Weight (kg)</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {sectionData.length === 0 ? (
                <tr><td colSpan={6} className="empty-cell">No data found. Add entries from the Entry Page!</td></tr>
              ) : (
                sectionData.map((row, i) => {
                  const diff = row.drgWeight - row.totalWeight;
                  const diffClass = Math.abs(diff) < 0.1 ? "" : diff > 0 ? "diff-over" : "diff-under";
                  return (
                    <tr key={`${row.section}-${row.sizeDisplay}`}>
                      <td>{i + 1}</td>
                      <td className="text-left">{row.section}</td>
                      <td className="text-left">{row.sizeDisplay}</td>  {/* ← full size string */}
                      <td className="numeric-cell">{fmt3(row.drgWeight)}</td>
                      <td className="numeric-cell">{fmt3(row.totalWeight)}</td>
                      <td className={`numeric-cell ${diffClass}`}>
                        {fmt3(Math.abs(diff))}
                        {Math.abs(diff) >= 0.1 && (
                          <span className="diff-indicator">{diff > 0 ? "▼" : "▲"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="total-row">
                <td colSpan={3} style={{ textAlign: "center" }}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.drgWeight)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
                <td className="numeric-cell">{fmt3(Math.abs(grandTotals.drgWeight - grandTotals.totalWeight))}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={7} className="table-title">
                  Drawing-wise Abstract{searchPONo && ` — POC: ${searchPONo}`}{searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th style={{ width: "36px" }}></th>
                <th>S.No</th>
                <th>Drawing No</th>
                <th>Part Name</th>
                <th>Drg Weight (Kg)</th>
                <th>Calc. Weight (kg)</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {drawingData.length === 0 ? (
                <tr><td colSpan={7} className="empty-cell">No data found. Add entries from the Entry Page!</td></tr>
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
                        <td className="text-left" style={{ fontWeight: 600 }}>{row.drawingNumber}</td>
                        <td className="text-left" style={{ fontWeight: 600 }}>{row.partName}</td>
                        <td className="numeric-cell" style={{ fontWeight: 600 }}>{fmt3(row.drgWeight)}</td>
                        <td className="numeric-cell" style={{ fontWeight: 600 }}>{fmt3(row.totalWeight)}</td>
                        <td className={`numeric-cell ${diffClass}`} style={{ fontWeight: 600 }}>
                          {fmt3(Math.abs(diff))}
                          {Math.abs(diff) >= 0.1 && (
                            <span className="diff-indicator">{diff > 0 ? "▼" : "▲"}</span>
                          )}
                        </td>
                      </tr>

                      {isExpanded && row.sections.map((sec, si) => (
                        <tr key={`${row.drawingNumber}-sec-${si}`} style={{ background: "#eef4fb" }}>
                          <td></td>
                          <td style={{ color: "#7f8c8d", fontSize: "12px", paddingLeft: "16px" }}>{si + 1}</td>
                          <td style={{ color: "#555", fontSize: "12px", paddingLeft: "16px" }}>
                            <span style={{ color: "#2980b9", marginRight: "6px" }}>↳</span>
                            {sec.section}
                          </td>
                          <td style={{ color: "#888", fontSize: "11px" }}>
                            Size: {sec.sizeDisplay}  {/* ← full size string */}
                          </td>
                          <td className="numeric-cell" style={{ color: "#555", fontSize: "12px" }}>{fmt3(sec.drgWeight)}</td>
                          <td className="numeric-cell" style={{ color: "#555", fontSize: "12px" }}>{fmt3(sec.totalWeight)}</td>
                          <td></td>
                        </tr>
                      ))}
                    </>
                  );
                })
              )}
              <tr className="total-row">
                <td></td>
                <td colSpan={3}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.drgWeight)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .diff-over { color: #e74c3c; font-weight: 600; }
        .diff-under { color: #27ae60; font-weight: 600; }
        .diff-indicator { font-size: 10px; margin-left: 4px; }
      `}</style>
    </div>
  );
}