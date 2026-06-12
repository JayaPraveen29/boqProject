import { useEffect, useState, useMemo } from "react";
import { db } from "../../firebase";
import { collection, getDocs, doc, deleteDoc, getDoc, updateDoc } from "firebase/firestore";
import "./ViewData.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export default function ViewData() {
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);

  // Filters
  const [searchPONo, setSearchPONo] = useState("");
  const [searchPartName, setSearchPartName] = useState("");
  const [searchWeightFOrder, setSearchWeightFOrder] = useState("");

  // Edit state: key = `${firestoreId}-${itemIndex}`, value = edited field values
  const [editingKey, setEditingKey] = useState(null);
  const [editValues, setEditValues] = useState({});

  // Fields shown in the table (drgWeight + difference added)
  const fields = [
    "pos", "drawingNumber", "partName", "quantity",
    "size", "length", "width", "singleWeight", "drgWeight", "totalWeight", "difference",
  ];

  const fieldLabels = {
    "pos": "POS",
    "drawingNumber": "Drawing No",
    "partName": "Part Name",
    "quantity": "Qty",
    "size": "Size",
    "length": "Length\n(mm)",
    "width": "Width\n(mm)",
    "singleWeight": "Single Wt\n(kg)",
    "drgWeight": "DRG Wt\n(kg)",
    "totalWeight": "Calc. Wt\n(kg)",
    "difference": "Diff\n(kg)",
  };

  const numericFields = new Set([
    "quantity", "length", "width", "singleWeight", "drgWeight", "totalWeight",
  ]);

  // Fields that are directly editable (not computed, not pos)
  const editableFields = new Set([
    "quantity", "size", "length", "width", "singleWeight", "drgWeight",
  ]);

  const noTotalFields = new Set([
    "pos", "drawingNumber", "partName", "size", "difference",
  ]);

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, "entries"));
      const rows = [];
      snap.docs.forEach((d) => {
        const entry = d.data();
        if (entry.items && Array.isArray(entry.items)) {
          entry.items.forEach((item, idx) => {
            rows.push({
              firestoreId: d.id,
              itemIndex: idx,
              poNo: entry.poNo || "",
              equipment: entry.equipment || "",
              weightFOrder: entry.weightFOrderEntered ?? entry.weightFOrder ?? 0,
              partName: entry.partName || "",
              drawingNumber: entry.drawingNumber || "",
              pos: item.pos,
              quantity: item.quantity,
              size: item.size || item.designation || "",
              length: item.length,
              width: item.width,
              singleWeight: item.singleWeight,
              drgWeight: item.drgWeight ?? 0,   // ← NEW
              totalWeight: item.totalWeight,
            });
          });
        }
      });
      rows.sort((a, b) => {
        if (a.drawingNumber < b.drawingNumber) return -1;
        if (a.drawingNumber > b.drawingNumber) return 1;
        return (a.pos || 0) - (b.pos || 0);
      });
      setData(rows);
    } catch (error) {
      console.error("Error fetching data:", error);
      alert("Error loading data!");
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    let result = [...data];
    if (searchPONo.trim()) result = result.filter((r) => r.poNo === searchPONo);
    if (searchPartName.trim()) result = result.filter((r) => r.partName === searchPartName);
    if (searchWeightFOrder.trim()) result = result.filter((r) => String(r.weightFOrder) === searchWeightFOrder);
    setFilteredData(result);
  }, [data, searchPONo, searchPartName, searchWeightFOrder]);

  const poNoOptions = useMemo(() => {
    const set = new Set(data.map((r) => r.poNo).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  const partNameOptions = useMemo(() => {
    const set = new Set(data.map((r) => r.partName).filter(Boolean));
    return Array.from(set).sort();
  }, [data]);

  const weightFOrderOptions = useMemo(() => {
    const set = new Set(data.map((r) => r.weightFOrder).filter((v) => v !== undefined && v !== null && v !== ""));
    return Array.from(set).sort((a, b) => a - b);
  }, [data]);

  // totals exclude "difference" (computed) and noTotalFields
  const totals = useMemo(() => {
    const t = {};
    fields.forEach((f) => (t[f] = 0));
    filteredData.forEach((row) => {
      fields.forEach((f) => {
        if (!noTotalFields.has(f) && f !== "difference") {
          const num = Number(row[f]);
          if (!isNaN(num)) t[f] += num;
        }
      });
    });
    return t;
  }, [filteredData]);

  const formatNum = (v, decimals = 3) => {
    const n = parseFloat(v);
    if (isNaN(n)) return "";
    return n.toFixed(decimals);
  };

  const parseNum = (v) => parseFloat(v?.toString().replace(/,/g, "")) || 0;

  // ── Edit helpers ──
  const startEdit = (row) => {
    const key = `${row.firestoreId}-${row.itemIndex}`;
    setEditingKey(key);
    setEditValues({
      quantity: row.quantity,
      size: row.size,
      length: row.length,
      width: row.width,
      singleWeight: row.singleWeight,
      drgWeight: row.drgWeight ?? 0,
    });
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValues({});
  };

  const handleEditChange = (field, value) => {
    setEditValues((prev) => {
      const updated = { ...prev, [field]: value };
      // Recalculate totalWeight live
      if (field === "quantity" || field === "singleWeight") {
        updated._totalWeight =
          parseNum(updated.quantity) * parseNum(updated.singleWeight);
      }
      return updated;
    });
  };

  const saveEdit = async (row) => {
    try {
      const docRef = doc(db, "entries", row.firestoreId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) { alert("Entry not found!"); return; }

      const entryData = docSnap.data();
      const updatedItems = entryData.items.map((item, idx) => {
        if (idx !== row.itemIndex) return item;
        const qty = parseNum(editValues.quantity);
        const sw = parseNum(editValues.singleWeight);
        const tw = qty * sw;
        return {
          ...item,
          quantity: qty,
          size: editValues.size,
          length: parseNum(editValues.length),
          width: parseNum(editValues.width),
          singleWeight: sw,
          drgWeight: parseNum(editValues.drgWeight),
          totalWeight: tw,
        };
      });

      const newCalcWeight = updatedItems.reduce(
        (sum, item) => sum + (parseFloat(item.totalWeight) || 0), 0
      );

      await updateDoc(docRef, {
        items: updatedItems,
        weightFOrderCalculated: newCalcWeight,
        weightFOrderDifference: (entryData.weightFOrderEntered || 0) - newCalcWeight,
      });

      alert("Row updated successfully!");
      setEditingKey(null);
      setEditValues({});
      await fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to save: " + err.message);
    }
  };

  // ── Delete ──
  const handleDelete = async (row) => {
    if (!window.confirm(
      `Delete POS ${String(row.pos).padStart(3, "0")} — ${row.size} from Drawing ${row.drawingNumber}?`
    )) return;
    try {
      const docRef = doc(db, "entries", row.firestoreId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) { alert("Entry not found!"); return; }
      const entryData = docSnap.data();
      if (entryData.items.length === 1) {
        await deleteDoc(docRef);
        alert("Entry deleted successfully!");
      } else {
        const updatedItems = entryData.items.filter((_, idx) => idx !== row.itemIndex);
        const newWeightFOrderCalculated = updatedItems.reduce(
          (sum, item) => sum + (parseFloat(item.totalWeight) || 0), 0
        );
        await updateDoc(docRef, {
          items: updatedItems,
          weightFOrderCalculated: newWeightFOrderCalculated,
          weightFOrderDifference: (entryData.weightFOrderEntered || 0) - newWeightFOrderCalculated,
        });
        alert("Row deleted successfully!");
      }
      await fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to delete: " + err.message);
    }
  };

  const selectedSummary = {
    poNo: searchPONo || "—",
    partName: searchPartName || "—",
    weightFOrder: searchWeightFOrder ? formatNum(searchWeightFOrder) : "—",
  };

  const hasAnyFilter = searchPONo || searchPartName || searchWeightFOrder;

  // ── Exports ──
  const exportExcel = () => {
    if (!filteredData.length) { alert("No data to export"); return; }
    const wsData = [];
    wsData.push(["SIEC-BOQ Parts List"]);
    wsData.push([]);
    wsData.push([
      "PO No:", selectedSummary.poNo,
      "Po. Desc:", selectedSummary.partName,
      "Po. Weight:", selectedSummary.weightFOrder,
    ]);
    wsData.push([]);
    const headers = [
      "S.No",
      ...fields.map((f) => fieldLabels[f]?.replace("\n", " ") || f),
    ];
    wsData.push(headers);
    filteredData.forEach((row, idx) => {
      const diff = parseNum(row.drgWeight) - parseNum(row.totalWeight);
      wsData.push([
        idx + 1,
        ...fields.map((f) => {
          if (f === "pos") return String(row[f]).padStart(3, "0");
          if (f === "difference") return formatNum(diff);
          if (numericFields.has(f)) return formatNum(row[f]);
          return row[f] ?? "";
        }),
      ]);
    });
    wsData.push([
      "TOTAL",
      ...fields.map((f) => {
        if (noTotalFields.has(f)) return "";
        return formatNum(totals[f]);
      }),
    ]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = headers.map(() => ({ wch: 15 }));
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
    XLSX.utils.book_append_sheet(wb, ws, "View Data");
    XLSX.writeFile(wb, `SIEC_BOQ_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPDF = () => {
    if (!filteredData.length) { alert("No data to export"); return; }
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
    pdf.setFontSize(16);
    pdf.setFont(undefined, "bold");
    pdf.text("SIEC-BOQ Parts List", 40, 40);
    pdf.setFont(undefined, "normal");
    pdf.setFontSize(11);
    pdf.text(
      `PO No: ${selectedSummary.poNo}    Po. Desc: ${selectedSummary.partName}    Po. Weight: ${selectedSummary.weightFOrder}`,
      40, 58
    );
    const tableColumns = [
      "S.No",
      ...fields.map((f) => fieldLabels[f]?.replace("\n", " ") || f),
    ];
    const tableRows = filteredData.map((row, idx) => {
      const diff = parseNum(row.drgWeight) - parseNum(row.totalWeight);
      return [
        idx + 1,
        ...fields.map((f) => {
          if (f === "pos") return String(row[f]).padStart(3, "0");
          if (f === "difference") return formatNum(diff);
          if (numericFields.has(f)) return formatNum(row[f]);
          return row[f] ?? "";
        }),
      ];
    });
    tableRows.push([
      "TOTAL",
      ...fields.map((f) => {
        if (noTotalFields.has(f)) return "";
        return formatNum(totals[f]);
      }),
    ]);
    const columnStyles = {};
    fields.forEach((f, idx) => {
      if (numericFields.has(f) || f === "difference") {
        columnStyles[idx + 1] = { halign: "right" };
      }
    });
    autoTable(pdf, {
      startY: 75,
      head: [tableColumns],
      body: tableRows,
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fontStyle: "bold" },
      columnStyles,
      didParseCell: (data) => {
        if (data.row.index === tableRows.length - 1)
          data.cell.styles.fontStyle = "bold";
      },
      margin: { top: 75, bottom: 40 },
      tableWidth: "auto",
      pageBreak: "auto",
      theme: "grid",
    });
    pdf.save(`SIEC_BOQ_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="entry-container">
      <h1 className="entry-heading">View Data</h1>

      {/* Controls */}
      <div className="controls-wrapper">
        <div className="controls-row">
          <div className="search-Group">
            <label className="filter-label">PO No:</label>
            <select
              className="unit-select"
              value={searchPONo}
              onChange={(e) => setSearchPONo(e.target.value)}
            >
              <option value="">All PO Nos</option>
              {poNoOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="search-Group">
            <label className="filter-label">Po. Desc:</label>
            <select
              className="unit-select"
              value={searchPartName}
              onChange={(e) => setSearchPartName(e.target.value)}
            >
              <option value="">All Descriptions</option>
              {partNameOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="search-Group">
            <label className="filter-label">Po. Weight:</label>
            <select
              className="unit-select"
              value={searchWeightFOrder}
              onChange={(e) => setSearchWeightFOrder(e.target.value)}
            >
              <option value="">All Weights</option>
              {weightFOrderOptions.map((w) => (
                <option key={w} value={w}>{formatNum(w)}</option>
              ))}
            </select>
          </div>

          <div className="actions-Group">
            {hasAnyFilter && (
              <button
                className="btn-clear"
                onClick={() => {
                  setSearchPONo("");
                  setSearchPartName("");
                  setSearchWeightFOrder("");
                }}
              >
                Clear
              </button>
            )}
            <button onClick={exportExcel} className="btn-export" style={{ marginRight: "10px" }}>
              Export Excel
            </button>
            <button onClick={exportPDF} className="btn-export">
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Filter summary */}
      <div className="selected-summary-box">
        <span><strong>PO No:</strong> {selectedSummary.poNo}</span>
        <span><strong>Po. Desc:</strong> {selectedSummary.partName}</span>
        <span><strong>Po. Weight:</strong> {selectedSummary.weightFOrder}</span>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="view-table">
          <thead>
            <tr>
              <th>S.No</th>
              {fields.map((f) => (
                <th key={f} style={{ whiteSpace: "pre-line" }}>
                  {fieldLabels[f]}
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 2} style={{ textAlign: "center", padding: "40px", color: "#95a5a6", fontStyle: "italic" }}>
                  No data found. Add entries from the Entry Page!
                </td>
              </tr>
            ) : (
              filteredData.map((row, idx) => {
                const rowKey = `${row.firestoreId}-${row.itemIndex}`;
                const isEditing = editingKey === rowKey;

                // Computed values for edit mode
                const editTotalWeight = isEditing
                  ? (parseNum(editValues.quantity) * parseNum(editValues.singleWeight))
                  : parseNum(row.totalWeight);
                const editDrgWeight = isEditing
                  ? parseNum(editValues.drgWeight)
                  : parseNum(row.drgWeight);
                const diff = editDrgWeight - editTotalWeight;

                return (
                  <tr key={rowKey} className={isEditing ? "editing-row" : ""}>
                    <td>{idx + 1}</td>

                    {fields.map((f) => {
                      // ── Computed / read-only display fields ──
                      if (f === "pos") {
                        return <td key={f} style={{ whiteSpace: "nowrap" }}>{String(row[f]).padStart(3, "0")}</td>;
                      }
                      if (f === "drawingNumber" || f === "partName") {
                        return <td key={f} style={{ whiteSpace: "nowrap" }}>{row[f] ?? ""}</td>;
                      }
                      if (f === "totalWeight") {
                        return (
                          <td key={f} className="numeric-cell" style={{ whiteSpace: "nowrap" }}>
                            {formatNum(editTotalWeight)}
                          </td>
                        );
                      }
                      if (f === "difference") {
                        const diffClass =
                          Math.abs(diff) < 0.001 ? "" : diff > 0 ? "diff-positive" : "diff-negative";
                        return (
                          <td key={f} className={`numeric-cell ${diffClass}`} style={{ whiteSpace: "nowrap" }}>
                            {formatNum(diff)}
                            {Math.abs(diff) >= 0.001 && (
                              <span className="diff-indicator" style={{ marginLeft: "4px" }}>
                                {diff > 0 ? "▲" : "▼"}
                              </span>
                            )}
                          </td>
                        );
                      }

                      // ── Editable fields ──
                      if (isEditing && editableFields.has(f)) {
                        if (f === "size") {
                          return (
                            <td key={f}>
                              <input
                                className="edit-input"
                                type="text"
                                value={editValues.size}
                                onChange={(e) => handleEditChange("size", e.target.value)}
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={f}>
                            <input
                              className="edit-input edit-input--numeric"
                              type="number"
                              step="0.001"
                              value={editValues[f]}
                              onChange={(e) => handleEditChange(f, e.target.value)}
                            />
                          </td>
                        );
                      }

                      // ── Default display ──
                      const displayValue = numericFields.has(f) ? formatNum(row[f]) : (row[f] ?? "");
                      return (
                        <td
                          key={f}
                          className={numericFields.has(f) ? "numeric-cell" : ""}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {displayValue}
                        </td>
                      );
                    })}

                    {/* Actions */}
                    <td className="actions-cell">
                      {isEditing ? (
                        <>
                          <button className="save-btn" onClick={() => saveEdit(row)} title="Save">✅ Save</button>
                          <button className="cancel-btn" onClick={cancelEdit} title="Cancel">✕ Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="edit-btn" onClick={() => startEdit(row)} title="Edit">✏️</button>
                          <button className="delete-btn" onClick={() => handleDelete(row)} title="Delete">🗑️</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}

            {/* Total row */}
            <tr className="total-row">
              <td style={{ fontWeight: "bold" }}>TOTAL</td>
              {fields.map((f) => {
                if (noTotalFields.has(f)) return <td key={f}></td>;
                return (
                  <td key={f} className="numeric-cell" style={{ fontWeight: "bold" }}>
                    {formatNum(totals[f])}
                  </td>
                );
              })}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Inline edit styles injected */}
      <style>{`
        .editing-row { background: #fffbea !important; }
        .edit-input {
          width: 90px;
          padding: 4px 6px;
          border: 1.5px solid #f0a500;
          border-radius: 4px;
          font-size: 13px;
          background: #fff;
        }
        .edit-input--numeric { text-align: right; }
        .edit-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          padding: 2px 5px;
          margin-right: 4px;
        }
        .save-btn {
          background: #27ae60;
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 12px;
          margin-right: 4px;
          white-space: nowrap;
        }
        .cancel-btn {
          background: #e74c3c;
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .actions-cell { white-space: nowrap; }
        .diff-positive { color: #27ae60; font-weight: 600; }
        .diff-negative { color: #e74c3c; font-weight: 600; }
        .diff-indicator { font-size: 10px; }
      `}</style>
    </div>
  );
}