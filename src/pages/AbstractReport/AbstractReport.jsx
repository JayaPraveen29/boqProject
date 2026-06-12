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
              rows.push({
                poNo: entry.poNo || "",
                equipment: entry.equipment || "",
                partName: entry.partName || "",
                drawingNumber: entry.drawingNumber || "",
                weightFOrder: entry.weightFOrderEntered ?? entry.weightFOrder ?? 0,
                pos: item.pos,
                quantity: Number(item.quantity) || 0,
                size: (item.size || item.designation || "").toString().trim(),
                length: Number(item.length) || 0,
                width: Number(item.width) || 0,
                singleWeight: Number(item.singleWeight) || 0,
                totalWeight: Number(item.totalWeight) || 0,
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

  const poNoOptions = useMemo(() => {
    return [...new Set(data.map((r) => r.poNo).filter(Boolean))].sort();
  }, [data]);

  const partNameOptions = useMemo(() => {
    return [...new Set(data.map((r) => r.partName).filter(Boolean))].sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    let result = [...data];
    if (searchPONo) result = result.filter((r) => r.poNo === searchPONo);
    if (searchPartName) result = result.filter((r) => r.partName === searchPartName);
    return result;
  }, [data, searchPONo, searchPartName]);

  const sectionData = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      const key = row.size || "Unknown";
      if (!grouped[key]) {
        grouped[key] = {
          size: key,
          totalQty: 0,
          totalLength: 0,
          totalWeight: 0,
          entries: 0,
        };
      }
      grouped[key].totalQty += row.quantity;
      grouped[key].totalLength += row.length * row.quantity;
      grouped[key].totalWeight += row.totalWeight;
      grouped[key].entries += 1;
    });
    return Object.values(grouped).sort((a, b) => a.size.localeCompare(b.size));
  }, [filteredRows]);

  const drawingData = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      const key = row.drawingNumber || "Unknown";
      if (!grouped[key]) {
        grouped[key] = {
          drawingNumber: key,
          partName: row.partName,
          totalQty: 0,
          totalWeight: 0,
          weightFOrder: row.weightFOrder,
        };
      }
      grouped[key].totalQty += row.quantity;
      grouped[key].totalWeight += row.totalWeight;
    });
    return Object.values(grouped).sort((a, b) => a.drawingNumber.localeCompare(b.drawingNumber));
  }, [filteredRows]);

  const grandTotals = useMemo(() => {
    if (viewMode === "section") {
      return {
        totalQty: sectionData.reduce((s, x) => s + x.totalQty, 0),
        totalLength: sectionData.reduce((s, x) => s + x.totalLength, 0),
        totalWeight: sectionData.reduce((s, x) => s + x.totalWeight, 0),
      };
    } else {
      return {
        totalQty: drawingData.reduce((s, x) => s + x.totalQty, 0),
        totalWeight: drawingData.reduce((s, x) => s + x.totalWeight, 0),
      };
    }
  }, [viewMode, sectionData, drawingData]);

  const fmt3 = (v) => Number(v).toFixed(3);
  const fmt0 = (v) => Number(v).toFixed(0);
  const fmtComma = (v) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });

  const summaryLine = `PO No: ${searchPONo || "All"}    Description: ${searchPartName || "All"}`;

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("SIEC-BOQ — Abstract Report", 40, 35);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    doc.text(summaryLine, 40, 52);
    doc.text(
      `View: ${viewMode === "section" ? "Section-wise (by Size)" : "Drawing-wise"}`,
      40,
      65
    );

    if (viewMode === "section") {
      const body = sectionData.map((row, i) => [
        i + 1,
        row.size,
        row.entries,
        fmt3(row.totalQty),
        fmt0(row.totalLength),
        fmt3(row.totalWeight),
      ]);
      body.push([
        "",
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
        "",
        { content: fmt3(grandTotals.totalQty), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt0(grandTotals.totalLength), styles: { fontStyle: "bold", halign: "right" } },
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
      ]);
      autoTable(doc, {
        startY: 80,
        head: [["S.No", "Section", "No. of Items", "Total Qty", "Total Length (mm)", "Total Weight (kg)"]],
        body,
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center", cellWidth: 35 },
          1: { halign: "left" },
          2: { halign: "center" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
      });
    } else {
      const body = drawingData.map((row, i) => [
        i + 1,
        row.drawingNumber,
        row.partName,
        fmt3(row.totalQty),
        fmt3(row.weightFOrder),
        fmt3(row.totalWeight),
        fmt3(Math.abs((row.weightFOrder || 0) - row.totalWeight)),
      ]);
      body.push([
        "",
        { content: "TOTAL", styles: { fontStyle: "bold", halign: "left" } },
        "",
        { content: fmt3(grandTotals.totalQty), styles: { fontStyle: "bold", halign: "right" } },
        "",
        { content: fmt3(grandTotals.totalWeight), styles: { fontStyle: "bold", halign: "right" } },
        "",
      ]);
      autoTable(doc, {
        startY: 80,
        head: [["S.No", "Drawing No", "Part Name", "Total Qty", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]],
        body,
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 3 },
        headStyles: { fontStyle: "bold" },
        columnStyles: {
          0: { halign: "center", cellWidth: 30 },
          1: { halign: "left" },
          2: { halign: "left" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
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
    wsData.push([`View: ${viewMode === "section" ? "Section-wise (by Size)" : "Drawing-wise"}`]);
    wsData.push([]);

    if (viewMode === "section") {
      wsData.push(["S.No", "Section", "No. of Items", "Total Qty", "Total Length (mm)", "Total Weight (kg)"]);
      sectionData.forEach((row, i) => {
        wsData.push([
          i + 1,
          row.size,
          row.entries,
          Number(fmt3(row.totalQty)),
          Number(fmt0(row.totalLength)),
          Number(fmt3(row.totalWeight)),
        ]);
      });
      wsData.push([
        "TOTAL", "", "",
        Number(fmt3(grandTotals.totalQty)),
        Number(fmt0(grandTotals.totalLength)),
        Number(fmt3(grandTotals.totalWeight)),
      ]);
    } else {
      wsData.push(["S.No", "Drawing No", "Part Name", "Total Qty", "Drg Weight (Kg)", "Calc. Weight (kg)", "Difference"]);
      drawingData.forEach((row, i) => {
        const diff = Math.abs((row.weightFOrder || 0) - row.totalWeight);
        wsData.push([
          i + 1,
          row.drawingNumber,
          row.partName,
          Number(fmt3(row.totalQty)),
          Number(fmt3(row.weightFOrder)),
          Number(fmt3(row.totalWeight)),
          Number(fmt3(diff)),
        ]);
      });
      wsData.push([
        "TOTAL", "", "",
        Number(fmt3(grandTotals.totalQty)),
        "",
        Number(fmt3(grandTotals.totalWeight)),
        "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = Array(7).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws, "Abstract Report");
    XLSX.writeFile(wb, "Abstract_Report_BOQ.xlsx");
  };

  const clearFilters = () => {
    setSearchPONo("");
    setSearchPartName("");
  };

  const hasFilter = searchPONo || searchPartName;

  return (
    <div className="abstract-container">
      <h1 className="abstract-heading">Abstract Report — Section-wise Breakup</h1>

      <div className="filter-container">
        <div className="filter-row">
          <label>PO No:</label>
          <select
            className="filter-select"
            value={searchPONo}
            onChange={(e) => setSearchPONo(e.target.value)}
          >
            <option value="">All PO Nos</option>
            {poNoOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <label>Description:</label>
          <select
            className="filter-select"
            value={searchPartName}
            onChange={(e) => setSearchPartName(e.target.value)}
          >
            <option value="">All Descriptions</option>
            {partNameOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

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

        <div className="button-row">
          {hasFilter && (
            <button className="btn-clear" onClick={clearFilters}>
              Clear Filters
            </button>
          )}
          <button className="btn-export btn-pdf" onClick={exportPDF}>
            Export PDF
          </button>
          <button className="btn-export btn-excel" onClick={exportExcel}>
            Export Excel
          </button>
        </div>
      </div>

      <div className="summary-box">
        <span><strong>PO No:</strong> {searchPONo || "All"}</span>
        <span><strong>Description:</strong> {searchPartName || "All"}</span>
        <span>
          <strong>Total Items:</strong>{" "}
          {viewMode === "section" ? sectionData.length : drawingData.length}
        </span>
        <span>
          <strong>Total Weight:</strong> {fmtComma(grandTotals.totalWeight)} kg
        </span>
      </div>

      <div className="table-wrapper">
        {viewMode === "section" ? (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={6} className="table-title">
                  Section-wise Abstract
                  {searchPONo && ` — PO: ${searchPONo}`}
                  {searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th>S.No</th>
                <th>Section</th>
                <th>No. of Items</th>
                <th>Total Qty</th>
                <th>Total Length (mm)</th>
                <th>Total Weight (kg)</th>
              </tr>
            </thead>
            <tbody>
              {sectionData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No data found. Add entries from the Entry Page!
                  </td>
                </tr>
              ) : (
                sectionData.map((row, i) => (
                  <tr key={row.size}>
                    <td>{i + 1}</td>
                    <td className="text-left">{row.size}</td>
                    <td>{row.entries}</td>
                    <td className="numeric-cell">{fmt3(row.totalQty)}</td>
                    <td className="numeric-cell">{fmtComma(row.totalLength)}</td>
                    <td className="numeric-cell">{fmt3(row.totalWeight)}</td>
                  </tr>
                ))
              )}
              <tr className="total-row">
                <td colSpan={3}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalQty)}</td>
                <td className="numeric-cell">{fmtComma(grandTotals.totalLength)}</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalWeight)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={7} className="table-title">
                  Drawing-wise Abstract
                  {searchPONo && ` — PO: ${searchPONo}`}
                  {searchPartName && ` (${searchPartName})`}
                </th>
              </tr>
              <tr>
                <th>S.No</th>
                <th>Drawing No</th>
                <th>Part Name</th>
                <th>Total Qty</th>
                <th>Drg Weight (Kg)</th>
                <th>Calc. Weight (kg)</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {drawingData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No data found. Add entries from the Entry Page!
                  </td>
                </tr>
              ) : (
                drawingData.map((row, i) => {
                  const diff = (row.weightFOrder || 0) - row.totalWeight;
                  const diffClass =
                    Math.abs(diff) < 0.001
                      ? ""
                      : diff > 0
                      ? "diff-over"
                      : "diff-under";
                  return (
                    <tr key={row.drawingNumber}>
                      <td>{i + 1}</td>
                      <td className="text-left">{row.drawingNumber}</td>
                      <td className="text-left">{row.partName}</td>
                      <td className="numeric-cell">{fmt3(row.totalQty)}</td>
                      <td className="numeric-cell">{fmt3(row.weightFOrder)}</td>
                      <td className="numeric-cell">{fmt3(row.totalWeight)}</td>
                      <td className={`numeric-cell ${diffClass}`}>
                        {fmt3(Math.abs(diff))}
                        {Math.abs(diff) > 0.001 && (
                          <span className="diff-indicator">
                            {diff > 0 ? "▼" : "▲"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="total-row">
                <td colSpan={3}>TOTAL</td>
                <td className="numeric-cell">{fmt3(grandTotals.totalQty)}</td>
                <td></td>
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