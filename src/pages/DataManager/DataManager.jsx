import { useState, useEffect, useMemo } from "react";
import { db } from "../../firebase";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";
import "./DataManager.css";

// Editable header-level fields stored directly on each "entries" document.
const FIELDS = [
  { key: "pocNo",               label: "POC No",                          type: "text"   },
  { key: "equipment",           label: "Equipment",                       type: "text"   },
  { key: "weightFOrderEntered", label: "Weight f. Order (KG) - Entered",  type: "number" },
  { key: "partName",            label: "Part Name",                       type: "text"   },
  { key: "drawingNumber",       label: "Drawing Number",                  type: "text"   },
];

export default function DataManager() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "entries"));
      const rows = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          pocNo: data.pocNo || data.poNo || "",
          equipment: data.equipment || "",
          weightFOrderEntered: data.weightFOrderEntered ?? 0,
          partName: data.partName || "",
          drawingNumber: data.drawingNumber || "",
          itemCount: Array.isArray(data.items) ? data.items.length : 0,
        };
      });
      rows.sort((a, b) => (a.drawingNumber || "").localeCompare(b.drawingNumber || ""));
      setEntries(rows);
    } catch (e) {
      console.error(e);
      showToast("Error fetching data", "error");
    }
    setLoading(false);
  };

  useEffect(() => { fetchEntries(); }, []);

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditValues({
      pocNo: row.pocNo,
      equipment: row.equipment,
      weightFOrderEntered: row.weightFOrderEntered,
      partName: row.partName,
      drawingNumber: row.drawingNumber,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const handleChange = (key, value) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
  };

  const saveEdit = async (row) => {
    setSaving(true);
    try {
      const weightEntered = parseFloat(String(editValues.weightFOrderEntered).replace(/,/g, "")) || 0;

      // Need the entry's current calculated weight to keep the difference accurate.
      const snap = await getDocs(collection(db, "entries"));
      const docSnap = snap.docs.find(d => d.id === row.id);
      const currentCalc = docSnap?.data()?.weightFOrderCalculated ?? 0;

      const updates = {
        pocNo: editValues.pocNo.trim(),
        poNo: editValues.pocNo.trim(), // keep both legacy fields in sync
        equipment: editValues.equipment.trim(),
        weightFOrderEntered: weightEntered,
        weightFOrderDifference: weightEntered - currentCalc,
        partName: editValues.partName.trim(),
        drawingNumber: editValues.drawingNumber.trim(),
      };

      await updateDoc(doc(db, "entries", row.id), updates);

      setEntries(prev => prev.map(e => e.id === row.id ? { ...e, ...updates } : e));
      setEditingId(null);
      setEditValues({});
      showToast("Entry updated successfully");
    } catch (e) {
      console.error(e);
      showToast("Error saving changes", "error");
    }
    setSaving(false);
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete the entire entry for Drawing "${row.drawingNumber}" / POC "${row.pocNo}"? This removes all its parts/items too.`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "entries", row.id));
      setEntries(prev => prev.filter(e => e.id !== row.id));
      showToast("Entry deleted");
    } catch (e) {
      console.error(e);
      showToast("Error deleting entry", "error");
    }
    setSaving(false);
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      [e.pocNo, e.equipment, e.partName, e.drawingNumber, String(e.weightFOrderEntered)]
        .some(v => v.toString().toLowerCase().includes(q))
    );
  }, [entries, searchQuery]);

  return (
    <div className="dm-container">
      {toast && (
        <div className={`dm-toast dm-toast--${toast.type}`}>
          <span>{toast.type === "success" ? "✓" : "✕"}</span>
          {toast.message}
        </div>
      )}

      <div className="dm-header">
        <div>
          <h1 className="dm-title">Data Manager</h1>
          <p className="dm-subtitle">Edit or remove the data saved on each entry — POC No, Equipment, Part Name, Drawing Number, and Weight f. Order (Entered).</p>
        </div>
      </div>

      <div className="dm-panel" style={{ borderRadius: "10px" }}>
        <div className="dm-toolbar">
          <div className="dm-search-wrapper" style={{ maxWidth: 420 }}>
            <span className="dm-search-icon">🔍</span>
            <input
              type="text"
              className="dm-search"
              placeholder="Search POC No, Equipment, Part Name, Drawing Number..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="dm-search-clear" onClick={() => setSearchQuery("")}>✕</button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="dm-loading">
            <div className="dm-spinner"></div>
            <span>Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="dm-empty">
            {searchQuery ? `No entries match "${searchQuery}"` : "No entries yet. Add one from the Entry Page."}
          </div>
        ) : (
          <div className="dm-table-wrapper">
            <table className="dm-table">
              <thead>
                <tr>
                  <th className="dm-th dm-th--no">#</th>
                  {FIELDS.map(f => (
                    <th className="dm-th" key={f.key}>{f.label}</th>
                  ))}
                  <th className="dm-th">Items</th>
                  <th className="dm-th dm-th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const isEditing = editingId === row.id;
                  return (
                    <tr key={row.id} className="dm-row">
                      <td className="dm-td dm-td--no">{idx + 1}</td>
                      {FIELDS.map(f => (
                        <td className="dm-td" key={f.key}>
                          {isEditing ? (
                            <input
                              type={f.type}
                              step={f.type === "number" ? "0.001" : undefined}
                              className="dm-rename-input"
                              value={editValues[f.key] ?? ""}
                              onChange={e => handleChange(f.key, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") saveEdit(row);
                                if (e.key === "Escape") cancelEdit();
                              }}
                            />
                          ) : (
                            <span className="dm-value-text">
                              {f.type === "number" ? Number(row[f.key]).toFixed(3) : (row[f.key] || "—")}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="dm-td">{row.itemCount}</td>
                      <td className="dm-td dm-td--actions">
                        {isEditing ? (
                          <div className="dm-action-btns">
                            <button className="dm-btn dm-btn--save dm-btn--sm" onClick={() => saveEdit(row)} disabled={saving}>
                              {saving ? "…" : "✓ Save"}
                            </button>
                            <button className="dm-btn dm-btn--cancel dm-btn--sm" onClick={cancelEdit}>✕</button>
                          </div>
                        ) : (
                          <div className="dm-action-btns">
                            <button className="dm-action-btn dm-action-btn--rename" onClick={() => startEdit(row)} title="Edit this entry">
                              ✏️ Edit
                            </button>
                            <button className="dm-action-btn dm-action-btn--delete" onClick={() => handleDelete(row)} title="Delete this entry">
                              🗑️ Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <div className="dm-footer">
            {searchQuery
              ? `Showing ${filtered.length} of ${entries.length} entries`
              : `${entries.length} entries total`}
          </div>
        )}
      </div>
    </div>
  );
}