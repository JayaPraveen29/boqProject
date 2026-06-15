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
              rows.push({
                poNo: entry.poNo || "",
                equipment: entry.equipment || "",
                partName: entry.partName || "",
                drawingNumber: entry.drawingNumber || "",
                pos: item.pos,
                quantity: toNum(item.quantity),
                section: (item.section || item.size || item.designation || "").toString().trim(),
                thickness: toNum(item.thickness),
                length: toNum(item.length),
                width: toNum(item.width),
                singleWeight: toNum(item.singleWeight),
                drgWeight: toNum(item.drgWeight),
                totalWeight: toNum(item.totalWeight),
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
  const partNameOptions = useMemo(() => [...new Set(data.map((r) => r.partName).filter(Boolean))].sort(), [data]);

  const filteredRows = useMemo(() => {
    let result = [...data];
    if (searchPONo) result = result.filter((r) => r.poNo === searchPONo);
    if (searchPartName) result = result.filter((r) => r.partName === searchPartName);
    return result;
  }, [data, searchPONo, searchPartName]);

  const sectionData = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      const key = `${row.section || "Unknown"}__${row.thickness || 0}`;
      if (!grouped[key]) {
        grouped[key] = {
          section: row.section || "Unknown",
          thickness: row.thickness || 0,
          totalQty: 0,
          drgWeight: 0,
          totalWeight: 0,
          entries: 0,
        };
      }
      grouped[key].totalQty += row.quantity;
      grouped[key].drgWeight += row.drgWeight;
      grouped[key].totalWeight += row.totalWeight;
      grouped[key].entries += 1;
    });
    return Object.values(grouped).sort((a, b) => {
      const sectionCmp = a.section.localeCompare(b.section);
      if (sectionCmp !== 0) return sectionCmp;
      return a.thickness - b.thickness;
    });
  }, [filteredRows]);

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
        };
      }
      grouped[key].drgWeight += row.drgWeight;
      grouped[key].totalWeight += row.totalWeight;
    });
    return Object.values(grouped).sort((a, b) => a.drawingNumber.localeCompare(b.drawingNumber));
  }, [filteredRows]);

  const grandTotals = useMemo(() => {
    if (viewMode === "section") {
      return {
        totalQty: sectionData.reduce((s, x) => s + x.totalQty, 0),
        drgWeight: sectionData.reduce((s, x) => s + x.drgWeight, 0),
        totalWeight: sectionData.reduce((s, x) => s + x.totalWeight, 0),
      };
    } else {
      return {
        drgWeight: drawingData.reduce((s, x) => s + x.drgWeight, 0),
        totalWeight: drawingData.reduce((s, x) => s + x.totalWeight, 0),
      };
    }
  }, [viewMode, sectionData, drawingData]);

  const fmt3 = (v) => { const n = Number(v); return isNaN(n) ? "0.000" : n.toFixed(1); };
  const fmtComma = (v) => { const n = Number(v); return isNaN(n) ? "0" : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }); };
  const summaryLine = `PO No: ${searchPONo || "All"}    Description: ${searchPartName || "All"}`;

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
        i + 1, row.section, fmt3(row.thickness), row.entries, fmt3(row.totalQty), fmt3(row.drgWeight), fmt3(row.totalWeight),
      ]);
      body.push([
        "",
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
        "", "",
        { content: fmt3(grandTotals.totalQty), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.drgWeight), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
      ]);
      autoTable(doc, {
        startY: 80,
        head: [["S.No", "Section", "Thickness (mm)", "No. of Items", "Total Qty", "Drg Weight (Kg)", "Calc. Weight (kg)"]],
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center", cellWidth: 30 },
          1: { halign: "left" },
          2: { halign: "right" },
          3: { halign: "center" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
        },
      });
    } else {
      const body = drawingData.map((row, i) => [
        i + 1, row.drawingNumber, row.partName,
        fmt3(row.drgWeight), fmt3(row.totalWeight),
        fmt3(Math.abs(row.drgWeight - row.totalWeight)),
      ]);
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
        head: [["S.No", "Drawing No", "Part Name", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]],
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center", cellWidth: 30 },
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
      wsData.push(["S.No", "Section", "Thickness (mm)", "No. of Items", "Total Qty", "Drg Weight (Kg)", "Calc. Weight (kg)"]);
      sectionData.forEach((row, i) => {
        wsData.push([i + 1, row.section, Number(fmt3(row.thickness)), row.entries, Number(fmt3(row.totalQty)), Number(fmt3(row.drgWeight)), Number(fmt3(row.totalWeight))]);
      });
      wsData.push(["TOTAL", "", "", "", Number(fmt3(grandTotals.totalQty)), Number(fmt3(grandTotals.drgWeight)), Number(fmt3(grandTotals.totalWeight))]);
    } else {
      wsData.push(["S.No", "Drawing No", "Part Name", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]);
      drawingData.forEach((row, i) => {
        const diff = Math.abs(row.drgWeight - row.totalWeight);
        wsData.push([i + 1, row.drawingNumber, row.partName, Number(fmt3(row.drgWeight)), Number(fmt3(row.totalWeight)), Number(fmt3(diff))]);
      });
      wsData.push(["TOTAL", "", "", Number(fmt3(grandTotals.drgWeight)), Number(fmt3(grandTotals.totalWeight)), ""]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = Array(6).fill({ wch: 20 });
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

          {/* PO No */}
          <div className="filter-group">
            <label>PO No:</label>
            <select className="filter-select" value={searchPONo} onChange={(e) => setSearchPONo(e.target.value)}>
              <option value="">All PO Nos</option>
              {poNoOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Description */}
          <div className="filter-group">
            <label>Description:</label>
            <select className="filter-select" value={searchPartName} onChange={(e) => setSearchPartName(e.target.value)}>
              <option value="">All Descriptions</option>
              {partNameOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* View By toggle */}
          <div className="filter-group">
            <label>View By:</label>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${viewMode === "section" ? "active" : ""}`}
                onClick={() => setViewMode("section")}
              >
                Section-wise
              </button>
              <button
                className={`toggle-btn ${viewMode === "drawing" ? "active" : ""}`}
                onClick={() => setViewMode("drawing")}
              >
                Drawing-wise
              </button>
            </div>
          </div>

        </div>

        <div className="button-row">
          {hasFilter && <button className="btn-clear" onClick={clearFilters}>Clear Filters</button>}
          <button className="btn-export btn-pdf" onClick={exportPDF}>Export PDF</button>
          <button className="btn-export btn-excel" onClick={exportExcel}>Export Excel</button>
        </div>
      </div>

      <div className="summary-box">
        <span><strong>PO No:</strong> {searchPONo || "All"}</span>
        <span><strong>Description:</strong> {searchPartName || "All"}</span>
        <span><strong>Total Items:</strong> {viewMode === "section" ? sectionData.length : drawingData.length}</span>
        <span><strong>Total Weight:</strong> {fmtComma(grandTotals.totalWeight)} kg</span>
      </div>

      <div className="table-wrapper">
        {viewMode === "section" ? (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={7} className="table-title">
                  Section-wise Abstract{searchPONo && ` — PO: ${searchPONo}`}{searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th>S.No</th>
                <th>Section</th>
                <th>Thickness (mm)</th>
                <th>No. of Items</th>
                <th>Total Qty</th>
                <th>Drg Weight (Kg)</th>
                <th>Calc. Weight (kg)</th>
              </tr>
            </thead>
            <tbody>
              {sectionData.length === 0 ? (
                <tr><td colSpan={7} className="empty-cell">No data found. Add entries from the Entry Page!</td></tr>
              ) : (
                sectionData.map((row, i) => (
                  <tr key={`${row.section}-${row.thickness}`}>
                    <td>{i + 1}</td>
                    <td className="text-left">{row.section}</td>
                    <td className="numeric-cell">{fmt3(row.thickness)}</td>
                    <td>{row.entries}</td>
                    <td className="numeric-cell">{fmt3(row.totalQty)}</td>
                    <td className="numeric-cell">{fmt3(row.drgWeight)}</td>
                    <td className="numeric-cell">{fmt3(row.totalWeight)}</td>
                  </tr>
                ))
              )}
              <tr className="total-row">
                <td colSpan={4} style={{ textAlign: "center" }}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalQty)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.drgWeight)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={6} className="table-title">
                  Drawing-wise Abstract{searchPONo && ` — PO: ${searchPONo}`}{searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
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
                <tr><td colSpan={6} className="empty-cell">No data found. Add entries from the Entry Page!</td></tr>
              ) : (
                drawingData.map((row, i) => {
                  const diff = row.drgWeight - row.totalWeight;
                  const diffClass = Math.abs(diff) < 0.1 ? "" : diff > 0 ? "diff-over" : "diff-under";
                  return (
                    <tr key={row.drawingNumber}>
                      <td>{i + 1}</td>
                      <td className="text-left">{row.drawingNumber}</td>
                      <td className="text-left">{row.partName}</td>
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
                <td colSpan={3}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.drgWeight)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}