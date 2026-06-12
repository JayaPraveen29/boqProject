import { useState, useEffect } from "react";
import { HiPlus, HiTrash } from "react-icons/hi2";
import { db } from "../../firebase";
import {
  collection, addDoc, getDocs, query, orderBy, limit, deleteDoc, doc
} from "firebase/firestore";
import "./EntryPage.css";

export default function EntryPage() {
  const [loading, setLoading] = useState(false);

  // Top header dropdowns
  const [headerData, setHeaderData] = useState({
    "PO No": "",
    "Equipment": "",
    "Part Name": "",
    "Drawing Number": "",
  });

  // Weight f. Order — user entered (manual input)
  const [weightFOrderEntered, setWeightFOrderEntered] = useState("");
  // Weight f. Order — calculated automatically from rows
  const [weightFOrderCalculated, setWeightFOrderCalculated] = useState(0);

  // Master data for dropdowns
  const [allPONos, setAllPONos] = useState([]);
  const [allEquipments, setAllEquipments] = useState([]);
  const [allPartNames, setAllPartNames] = useState([]);
  const [allDrawingNumbers, setAllDrawingNumbers] = useState([]);
  const [allSizes, setAllSizes] = useState([]);
  const [allLengths, setAllLengths] = useState([]);
  const [allWidths, setAllWidths] = useState([]);

  // Custom input states
  const [customInputs, setCustomInputs] = useState({});

  // Rows
  const [items, setItems] = useState([{
    id: Date.now(),
    pos: 1,
    quantity: "",
    size: "",
    length: "",
    width: "",
    singleWeight: "",
    drgWeight: "",      // ← NEW
    CalucatedWeight: "",
    totalWeight: 0,
  }]);

  // Next POS per drawing number
  const [nextPos, setNextPos] = useState(1);

  const fetchMasterData = async () => {
    try {
      const [poNoSnap, eqSnap, pnSnap, dnSnap, sizeSnap, lenSnap, widSnap] = await Promise.all([
        getDocs(collection(db, "poNos")),
        getDocs(collection(db, "equipments")),
        getDocs(collection(db, "partNames")),
        getDocs(collection(db, "drawingNumbers")),
        getDocs(collection(db, "sizes")),
        getDocs(collection(db, "lengths")),
        getDocs(collection(db, "widths")),
      ]);

      const map = (snap) =>
        snap.docs
          .map((d) => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true }))
          .filter((i) => i.value)
          .sort((a, b) => a.value.localeCompare(b.value));

      setAllPONos(map(poNoSnap));
      setAllEquipments(map(eqSnap));
      setAllPartNames(map(pnSnap));
      setAllDrawingNumbers(map(dnSnap));
      setAllSizes(map(sizeSnap));
      setAllLengths(map(lenSnap));
      setAllWidths(map(widSnap));
    } catch (error) {
      console.error("Error fetching master data:", error);
      alert("Error fetching data from Firebase");
    }
  };

  // Fetch next POS for selected drawing number
  const fetchNextPos = async (drawingNumber) => {
    if (!drawingNumber) { setNextPos(1); return; }
    try {
      const q = query(
        collection(db, "entries"),
        orderBy("drawingNumber"),
      );
      const snap = await getDocs(q);
      let maxPos = 0;
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.drawingNumber === drawingNumber && data.items) {
          data.items.forEach((item) => {
            if (item.pos > maxPos) maxPos = item.pos;
          });
        }
      });
      setNextPos(maxPos + 1);
      // Update items POS starting from maxPos+1
      setItems((prev) =>
        prev.map((item, idx) => ({ ...item, pos: maxPos + 1 + idx }))
      );
    } catch (e) {
      console.error("Error fetching POS:", e);
    }
  };

  useEffect(() => {
    fetchMasterData();
  }, []);

  useEffect(() => {
    fetchNextPos(headerData["Drawing Number"]);
  }, [headerData["Drawing Number"]]);

  // Auto calculate Weight f. Order (Calculated) = sum of all totalWeights
  useEffect(() => {
    const total = items.reduce((sum, item) => sum + (parseFloat(item.totalWeight) || 0), 0);
    setWeightFOrderCalculated(total);
  }, [items]);

  const parseNum = (v) => parseFloat(v?.toString().replace(/,/g, "")) || 0;

  const formatNum = (n) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const handleHeaderChange = (key, value) => {
    setHeaderData((prev) => ({ ...prev, [key]: value }));
  };

  // Single Weight is entered by user; Total Weight = Quantity x Single Weight (auto-calculated)
  const handleItemChange = (id, key, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [key]: value };
        if (key === "quantity" || key === "singleWeight") {
          updated.totalWeight =
            parseNum(updated.quantity) * parseNum(updated.singleWeight);
        }
        return updated;
      })
    );
  };

  const addRow = () => {
    const lastPos = items.length > 0 ? items[items.length - 1].pos : nextPos - 1;
    setItems((prev) => [
      ...prev,
      {
        id: Date.now(),
        pos: lastPos + 1,
        quantity: "",
        size: "",
        length: "",
        width: "",
        singleWeight: "",
        drgWeight: "",    // ← NEW
        totalWeight: 0,
      },
    ]);
  };

  const removeRow = (id) => {
    if (items.length === 1) return;
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== id);
      // Recalculate POS after removal
      return filtered.map((item, idx) => ({ ...item, pos: nextPos + idx }));
    });
  };

  // ── Custom input helpers ──
  const toggleCustomInput = (key) => {
    setCustomInputs((prev) => ({
      ...prev,
      [key]: { show: !prev[key]?.show, value: prev[key]?.value || "" },
    }));
  };

  const setCustomInputValue = (key, value) => {
    setCustomInputs((prev) => ({ ...prev, [key]: { ...prev[key], value } }));
  };

  const getCustomInputState = (key) =>
    customInputs[key] || { show: false, value: "" };

  const handleAddCustomValue = async (collectionName, value, setOptions, currentOptions, onSelect) => {
    if (!value.trim()) { alert("Please enter a value!"); return; }
    const trimmed = value.trim();
    const existing = currentOptions.find(
      (o) => o.value.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      alert(`"${trimmed}" already exists.`);
      onSelect(existing.value);
      return;
    }
    try {
      const docRef = await addDoc(collection(db, collectionName), { value: trimmed });
      const newOption = { id: docRef.id, value: trimmed, isManual: true };
      setOptions((prev) =>
        [...prev, newOption].sort((a, b) => a.value.localeCompare(b.value))
      );
      onSelect(trimmed);
      alert(`"${trimmed}" added successfully!`);
    } catch (error) {
      console.error("Error adding value:", error);
      alert("Error adding value. Please try again.");
    }
  };

  const handleDeleteValue = async (collectionName, option, setOptions, fieldKey) => {
    if (!window.confirm(`Delete "${option.value}"?`)) return;
    try {
      await deleteDoc(doc(db, collectionName, option.id));
      setOptions((prev) => prev.filter((o) => o.id !== option.id));
      // Clear from header if selected
      if (fieldKey) {
        setHeaderData((prev) =>
          prev[fieldKey] === option.value ? { ...prev, [fieldKey]: "" } : prev
        );
      }
      // Clear from items if size / length / width
      if (["sizes", "lengths", "widths"].includes(collectionName)) {
        const itemKey = collectionName === "sizes" ? "size" : collectionName === "lengths" ? "length" : "width";
        setItems((prev) =>
          prev.map((item) =>
            item[itemKey] === option.value ? { ...item, [itemKey]: "" } : item
          )
        );
      }
      alert(`"${option.value}" deleted!`);
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Error deleting. Please try again.");
    }
  };

  const renderDropdown = (
    label, value, onChange, options,
    collectionName, setOptions, fieldKey = null,
    onSelect = null
  ) => {
    const key = collectionName;
    const customState = getCustomInputState(key);
    const handleSelect = onSelect || ((val) => onChange({ target: { value: val } }));

    return (
      <div className="entry-input">
        <label>{label} ({options.length})</label>
        <div className="dropdown-container">
          <div className="dropdown-row">
            <select
              className="dropdown-select"
              value={value}
              onChange={onChange}
            >
              <option value="">Select {label}</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.value}>{opt.value}</option>
              ))}
            </select>
            <button
              className="btn-toggle-custom"
              onClick={() => toggleCustomInput(key)}
              type="button"
            >
              {customState.show ? "✕" : "+"}
            </button>
          </div>

          {customState.show && (
            <div className="custom-input-section">
              <div className="custom-input-row">
                <input
                  type="text"
                  className="custom-input-field"
                  value={customState.value}
                  onChange={(e) => setCustomInputValue(key, e.target.value)}
                  placeholder={`Enter new ${label.toLowerCase()}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      handleAddCustomValue(
                        collectionName, customState.value,
                        setOptions, options, handleSelect
                      );
                  }}
                />
                <button
                  className="btn-add-custom"
                  onClick={() =>
                    handleAddCustomValue(
                      collectionName, customState.value,
                      setOptions, options, handleSelect
                    )
                  }
                  type="button"
                >
                  Add
                </button>
              </div>
              <div className="manual-values-list">
                <div className="custom-values-header">Saved Values</div>
                {options.filter((o) => o.isManual).length === 0 ? (
                  <div className="no-manual-values">No values yet</div>
                ) : (
                  options.filter((o) => o.isManual).map((opt) => (
                    <div key={opt.id} className="manual-value-item">
                      <span className="manual-value-text">{opt.value}</span>
                      <button
                        className="btn-delete-value"
                        onClick={() =>
                          handleDeleteValue(collectionName, opt, setOptions, fieldKey)
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Per-row dropdown for Size / Length / Width (with unique key per row)
  const renderRowDropdown = (item, fieldKey, label, options, collectionName, setOptions) => {
    const key = `${fieldKey}-${item.id}`;
    const customState = getCustomInputState(key);

    return (
      <div className="entry-input" style={{ minWidth: "180px" }}>
        <label>{label} ({options.length})</label>
        <div className="dropdown-container">
          <div className="dropdown-row">
            <select
              className="dropdown-select"
              value={item[fieldKey]}
              onChange={(e) => handleItemChange(item.id, fieldKey, e.target.value)}
            >
              <option value="">Select {label}</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.value}>{opt.value}</option>
              ))}
            </select>
            <button
              className="btn-toggle-custom"
              onClick={() => toggleCustomInput(key)}
              type="button"
            >
              {customState.show ? "✕" : "+"}
            </button>
          </div>

          {customState.show && (
            <div className="custom-input-section">
              <div className="custom-input-row">
                <input
                  type="text"
                  className="custom-input-field"
                  value={customState.value}
                  onChange={(e) => setCustomInputValue(key, e.target.value)}
                  placeholder={`Enter new ${label.toLowerCase()}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      handleAddCustomValue(
                        collectionName, customState.value,
                        setOptions, options,
                        (val) => handleItemChange(item.id, fieldKey, val)
                      );
                  }}
                />
                <button
                  className="btn-add-custom"
                  onClick={() =>
                    handleAddCustomValue(
                      collectionName, customState.value,
                      setOptions, options,
                      (val) => handleItemChange(item.id, fieldKey, val)
                    )
                  }
                  type="button"
                >
                  Add
                </button>
              </div>
              <div className="manual-values-list">
                <div className="custom-values-header">Saved Values</div>
                {options.filter((o) => o.isManual).length === 0 ? (
                  <div className="no-manual-values">No values yet</div>
                ) : (
                  options.filter((o) => o.isManual).map((opt) => (
                    <div key={opt.id} className="manual-value-item">
                      <span className="manual-value-text">{opt.value}</span>
                      <button
                        className="btn-delete-value"
                        onClick={() =>
                          handleDeleteValue(collectionName, opt, setOptions, null)
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleSubmit = async () => {
    if (!headerData["PO No"]) return alert("Please select PO No");
    if (!headerData["Drawing Number"]) return alert("Please select Drawing Number");
    setLoading(true);
    try {
      const docData = {
        poNo: headerData["PO No"],
        equipment: headerData["Equipment"],
        weightFOrderEntered: parseNum(weightFOrderEntered),
        weightFOrderCalculated: weightFOrderCalculated,
        weightFOrderDifference: parseNum(weightFOrderEntered) - weightFOrderCalculated,
        partName: headerData["Part Name"],
        drawingNumber: headerData["Drawing Number"],
        items: items.map((i) => ({
          pos: i.pos,
          quantity: parseNum(i.quantity),
          size: i.size,
          length: parseNum(i.length),
          width: parseNum(i.width),
          singleWeight: parseNum(i.singleWeight),
          drgWeight: parseNum(i.drgWeight),   // ← NEW
          totalWeight: parseNum(i.totalWeight),
        })),
        totalWeight: weightFOrderCalculated,
        createdAt: new Date(),
      };
      await addDoc(collection(db, "entries"), docData);
      alert("Entry saved successfully!");
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("Save Error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const weightDifference = parseNum(weightFOrderEntered) - weightFOrderCalculated;

  return (
    <div className="entry-container">
      <h1 className="entry-heading">SIEC-BOQ Entry</h1>

      {/* Top Header Dropdowns */}
      <div className="form-wrapper">
        <h3>Project Details</h3>
        <div className="entry-grid">

          {renderDropdown(
            "PO No",
            headerData["PO No"],
            (e) => handleHeaderChange("PO No", e.target.value),
            allPONos, "poNos", setAllPONos, "PO No"
          )}

          {renderDropdown(
            "Equipment",
            headerData["Equipment"],
            (e) => handleHeaderChange("Equipment", e.target.value),
            allEquipments, "equipments", setAllEquipments, "Equipment"
          )}

          {/* Weight f. Order - user entered */}
          <div className="entry-input">
            <label>Weight f. Order (KG) - Entered</label>
            <input
              type="number"
              step="0.001"
              value={weightFOrderEntered}
              onChange={(e) => setWeightFOrderEntered(e.target.value)}
              placeholder="Enter expected weight"
            />
          </div>

          {renderDropdown(
            "Part Name",
            headerData["Part Name"],
            (e) => handleHeaderChange("Part Name", e.target.value),
            allPartNames, "partNames", setAllPartNames, "Part Name"
          )}

          {renderDropdown(
            "Drawing Number",
            headerData["Drawing Number"],
            (e) => handleHeaderChange("Drawing Number", e.target.value),
            allDrawingNumbers, "drawingNumbers", setAllDrawingNumbers, "Drawing Number"
          )}

        </div>

        <hr />
        <h3>Parts / Items</h3>

        {items.map((item, index) => (
          <div key={item.id} className="section-card">
            {items.length > 1 && (
              <button
                className="remove-row-btn"
                onClick={() => removeRow(item.id)}
                type="button"
              >
                <HiTrash /> Remove
              </button>
            )}
            <h4>Row #{index + 1} — POS: {String(item.pos).padStart(3, "0")}</h4>

            <div className="section-grid">

              <div className="entry-input">
                <label>Quantity</label>
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => handleItemChange(item.id, "quantity", e.target.value)}
                />
              </div>

              {renderRowDropdown(item, "size", "Size", allSizes, "sizes", setAllSizes)}
              {renderRowDropdown(item, "length", "Length", allLengths, "lengths", setAllLengths)}
              {renderRowDropdown(item, "width", "Width", allWidths, "widths", setAllWidths)}

              <div className="entry-input">
                <label>Single Weight (kg)</label>
                <input
                  type="number"
                  step="0.001"
                  value={item.singleWeight}
                  onChange={(e) => handleItemChange(item.id, "singleWeight", e.target.value)}
                />
              </div>

              {/* ── NEW: DRG Weight ── */}
              <div className="entry-input">
                <label>DRG Weight (kg)</label>
                <input
                  type="number"
                  step="0.001"
                  value={item.drgWeight}
                  onChange={(e) => handleItemChange(item.id, "drgWeight", e.target.value)}
                />
              </div>

              <div className="entry-input">
                <label>Calculated Weight (Kg)</label>
                <input
                  type="text"
                  className="readonly-field"
                  value={formatNum(parseNum(item.totalWeight))}
                  readOnly
                />
              </div>

            </div>
          </div>
        ))}

        <button className="add-section-btn" onClick={addRow} type="button">
          <HiPlus /> Add Another Row
        </button>

        {/* Summary */}
        <div className="summary-box">
          <div className="summary-content">
            <div>
              <h4>Weight f. Order</h4>
              <p>Entered: {formatNum(parseNum(weightFOrderEntered))} KG</p>
              <p>Calculated: {formatNum(weightFOrderCalculated)} KG</p>
              <h2 className="grand-total" style={{ color: weightDifference === 0 ? "inherit" : (weightDifference > 0 ? "green" : "red") }}>
                Difference: {formatNum(weightDifference)} KG
              </h2>
            </div>
            <div>
              <p>Total Rows: {items.length}</p>
              <p>Drawing Number: {headerData["Drawing Number"] || "—"}</p>
              <p>PO No: {headerData["PO No"] || "—"}</p>
            </div>
          </div>
        </div>

        <button
          className="entry-submit"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "Saving..." : "Save Entry"}
        </button>

      </div>
    </div>
  );
}