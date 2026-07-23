import { useState, useEffect, useMemo } from "react";
import { db, collection, getDocs, addDoc, updateDoc, doc } from "../../dataClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./SectionalWeightsReport.css";

export default function SectionalWeightsReport() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Master lookup data — needed to resolve a section/size row back to the
  // sectionSectionalWeights record that should be updated when edited.
  const [allSections, setAllSections] = useState([]);
  const [allSizes, setAllSizes] = useState([]);
  const [sectionSectionalWeights, setSectionSectionalWeights] = useState([]);

  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [entriesSnap, secSnap, sizeSnap, sswSnap] = await Promise.all([
        getDocs(collection(db, "entries")),
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "thicknesses")),
        getDocs(collection(db, "sectionSectionalWeights")),
      ]);

      const mapSnap = (snap) =>
        snap.docs
          .map((d) => ({ id: d.id, value: d.data().value?.trim() || "" }))
          .filter((i) => i.value);

      setAllSections(mapSnap(secSnap));
      setAllSizes(mapSnap(sizeSnap));
      setSectionSectionalWeights(sswSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const map = new Map(); // dedupe by section|size (length intentionally ignored)

      entriesSnap.docs.forEach((d) => {
        const data = d.data();
        if (!Array.isArray(data.items)) return;
        data.items.forEach((item) => {
          const section = (item.section ?? "").toString().trim();
          const size = item.size ?? "";
          const sectionalWeight = item.sectionalWeight ?? "";

          // Only include rows that actually have a section and a sectional weight
          if (!section || sectionalWeight === "" || sectionalWeight === undefined || sectionalWeight === null) return;

          const key = `${section}|${size}`;
          if (!map.has(key)) {
            map.set(key, { section, size, sectionalWeight });
          }
        });
      });

      const unique = Array.from(map.values()).sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section, undefined, { numeric: true });
        return String(a.size).localeCompare(String(b.size), undefined, { numeric: true });
      });

      setRows(unique);
    } catch (e) {
      console.error("Error fetching sectional weights report:", e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.section, r.size, r.sectionalWeight]
        .some((v) => v.toString().toLowerCase().includes(q))
    );
  }, [rows, searchQuery]);

  const formatNum = (v) => {
    const n = parseFloat(v);
    if (isNaN(n)) return v ?? "—";
    return n.toFixed(3);
  };

  const startEdit = (row) => {
    const key = `${row.section}|${row.size}`;
    setEditingKey(key);
    setEditValue(String(row.sectionalWeight));
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue("");
  };

  // Saves the edited value back to the sectionSectionalWeights master
  // collection (the same table EntryPage reads from to auto-fill future
  // rows). This updates the master lookup value; it does not rewrite
  // sectionalWeight on historical entries already saved.
  const saveEdit = async (row) => {
    const newWeight = parseFloat(editValue);
    if (isNaN(newWeight)) { alert("Please enter a valid number."); return; }

    const sectionObj = allSections.find(
      (s) => s.value.toLowerCase() === row.section.trim().toLowerCase()
    );
    if (!sectionObj) {
      alert(`Could not find "${row.section}" in the Sections master list. Cannot save.`);
      return;
    }

    const sizeStr = row.size !== "" && row.size !== undefined && row.size !== null ? String(row.size).trim() : "";
    const sizeObj = sizeStr ? allSizes.find((s) => s.value.trim() === sizeStr) : null;
    const sizeId = sizeObj ? sizeObj.id : null;

    setSaving(true);
    try {
      const existing = sectionSectionalWeights.find((r) => {
        const sectionMatch = r.sectionId === sectionObj.id;
        const sizeMatch = sizeId ? r.sizeId === sizeId : !r.sizeId;
        return sectionMatch && sizeMatch;
      });

      const newData = {
        sectionId: sectionObj.id,
        ...(sizeId ? { sizeId } : {}),
        sectionalWeight: newWeight,
      };

      if (existing) {
        await updateDoc(doc(db, "sectionSectionalWeights", existing.id), newData);
        setSectionSectionalWeights((prev) =>
          prev.map((r) => (r.id === existing.id ? { ...r, ...newData } : r))
        );
      } else {
        const docRef = await addDoc(collection(db, "sectionSectionalWeights"), newData);
        setSectionSectionalWeights((prev) => [...prev, { id: docRef.id, ...newData }]);
      }

      // Reflect the change immediately in the displayed table
      setRows((prev) =>
        prev.map((r) =>
          r.section === row.section && String(r.size) === String(row.size)
            ? { ...r, sectionalWeight: newWeight }
            : r
        )
      );

      setEditingKey(null);
      setEditValue("");
    } catch (e) {
      console.error("Error saving sectional weight:", e);
      alert("Error saving. Please try again.");
    }
    setSaving(false);
  };

  // ─── Export helpers ────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("Sectional Weights Report", 40, 35);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    if (searchQuery) {
      doc.text(`Search: "${searchQuery}"`, 40, 52);
    }

    const body = filtered.map((row, i) => [
      i + 1,
      row.section || "—",
      row.size !== "" ? row.size : "—",
      formatNum(row.sectionalWeight),
    ]);

    autoTable(doc, {
      startY: searchQuery ? 65 : 55,
      head: [["S.No", "Section", "Size (mm)", "Sectional Weight (kg/m)"]],
      body,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fontStyle: "bold" },
      columnStyles: {
        0: { halign: "center", cellWidth: 40 },
        1: { halign: "left" },
        2: { halign: "left" },
        3: { halign: "right" },
      },
    });

    doc.save("Sectional_Weights_Report.pdf");
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [];
    wsData.push(["Sectional Weights Report"]);
    if (searchQuery) wsData.push([`Search: "${searchQuery}"`]);
    wsData.push([]);
    wsData.push(["S.No", "Section", "Size (mm)", "Sectional Weight (kg/m)"]);

    filtered.forEach((row, i) => {
      wsData.push([
        i + 1,
        row.section || "—",
        row.size !== "" ? row.size : "—",
        Number(formatNum(row.sectionalWeight)),
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 8 }, { wch: 22 }, { wch: 18 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, "Sectional Weights");
    XLSX.writeFile(wb, "Sectional_Weights_Report.xlsx");
  };

  return (
    <div className="swr-container">
      <h1 className="swr-heading">Sectional Weights Report</h1>
      

      <div className="swr-toolbar">
        <div className="swr-search-wrapper">
          <span className="swr-search-icon">🔍</span>
          <input
            type="text"
            className="swr-search"
            placeholder="Search Section, Size, Sectional Weight..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="swr-search-clear" onClick={() => setSearchQuery("")}>✕</button>
          )}
        </div>
        <div className="swr-toolbar-actions">
          <button className="swr-export-btn swr-export-btn--pdf" onClick={exportPDF} disabled={loading || filtered.length === 0}>
            Export PDF
          </button>
          <button className="swr-export-btn swr-export-btn--excel" onClick={exportExcel} disabled={loading || filtered.length === 0}>
            Export Excel
          </button>
          <button className="swr-refresh-btn" onClick={fetchData} disabled={loading}>
            {loading ? "Loading..." : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="swr-loading">
          <div className="swr-spinner"></div>
          <span>Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="swr-empty">
          {searchQuery ? `No results for "${searchQuery}"` : "No sectional weight data found yet."}
        </div>
      ) : (
        <div className="swr-table-wrapper">
          <table className="swr-table">
            <thead>
              <tr>
                <th className="swr-th swr-th--no">#</th>
                <th className="swr-th">Section</th>
                <th className="swr-th">Size (mm)</th>
                <th className="swr-th">Sectional Weight (kg/m)</th>
                <th className="swr-th" style={{ width: "110px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const rowKey = `${row.section}|${row.size}`;
                const isEditing = editingKey === rowKey;
                return (
                  <tr key={idx} className="swr-row" style={isEditing ? { background: "#fffbea" } : undefined}>
                    <td className="swr-td swr-td--no">{idx + 1}</td>
                    <td className="swr-td">{row.section || "—"}</td>
                    <td className="swr-td">{row.size !== "" ? row.size : "—"}</td>
                    <td className="swr-td swr-td--numeric">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.001"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          style={{
                            width: "100px",
                            padding: "4px 6px",
                            border: "1.5px solid #f0a500",
                            borderRadius: "4px",
                            fontSize: "13px",
                            textAlign: "right",
                          }}
                        />
                      ) : (
                        formatNum(row.sectionalWeight)
                      )}
                    </td>
                    <td className="swr-td" style={{ whiteSpace: "nowrap" }}>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEdit(row)}
                            disabled={saving}
                            style={{
                              background: "#27ae60", color: "#fff", border: "none", borderRadius: "4px",
                              padding: "4px 10px", cursor: "pointer", fontSize: "12px", marginRight: "4px",
                            }}
                          >
                            {saving ? "Saving..." : "✅ Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            style={{
                              background: "#e74c3c", color: "#fff", border: "none", borderRadius: "4px",
                              padding: "4px 10px", cursor: "pointer", fontSize: "12px",
                            }}
                          >
                            ✕ Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px" }}
                          title="Edit sectional weight"
                        >
                          ✏️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
