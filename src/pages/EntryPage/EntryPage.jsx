import { useState, useEffect } from "react";
import { HiPlus, HiTrash } from "react-icons/hi2";
import { db } from "../../firebase";
import {
  collection, addDoc, getDocs, query, orderBy, deleteDoc, doc
} from "firebase/firestore";
import "./EntryPage.css";

const DENSITY = 7.85; // g/cm³ for steel

export default function EntryPage() {
  const [loading, setLoading] = useState(false);

  const [headerData, setHeaderData] = useState({
    "PO No": "",
    "Equipment": "",
    "Part Name": "",
    "Drawing Number": "",
  });

  const [weightFOrderEntered, setWeightFOrderEntered] = useState("");
  const [weightFOrderCalculated, setWeightFOrderCalculated] = useState(0);

  const [allPONos, setAllPONos] = useState([]);
  const [allEquipments, setAllEquipments] = useState([]);
  const [allPartNames, setAllPartNames] = useState([]);
  const [allDrawingNumbers, setAllDrawingNumbers] = useState([]);
  const [allSections, setAllSections] = useState([]);
  const [allSizes, setAllSizes] = useState([]);         // renamed from allThicknesses
  const [allLengths, setAllLengths] = useState([]);
  const [allWidths, setAllWidths] = useState([]);

  // Tracks which field's suggestion dropdown is currently open
  const [activeSuggestion, setActiveSuggestion] = useState(null);

  const [items, setItems] = useState([{
    id: Date.now(),
    pos: 1,
    quantity: "",
    section: "",
    size: "",             // renamed from thickness
    length: "",
    width: "",
    sectionalWeight: "",  // new field
    singleWeight: "",
    drgWeight: "",
    drgWeightManual: false,
    calcWeightManual: false,
    isPlate: true,        // determines which calc formula to use
    totalWeight: 0,
  }]);

  const [nextPos, setNextPos] = useState(1);

  // Map of poNo -> weightFOrderEntered from existing entries
  const [poWeightMap, setPoWeightMap] = useState({});

  const fetchMasterData = async () => {
    try {
      const [poNoSnap, eqSnap, pnSnap, dnSnap, secSnap, sizeSnap, lenSnap, widSnap] = await Promise.all([
        getDocs(collection(db, "poNos")),
        getDocs(collection(db, "equipments")),
        getDocs(collection(db, "partNames")),
        getDocs(collection(db, "drawingNumbers")),
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "thicknesses")),   // collection still named thicknesses in DB
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
      setAllSections(map(secSnap));
      setAllSizes(map(sizeSnap));
      setAllLengths(map(lenSnap));
      setAllWidths(map(widSnap));

      // Build poNo -> weightFOrderEntered map from entries
      const entriesSnap = await getDocs(collection(db, "entries"));
      const weightMap = {};
      entriesSnap.docs.forEach((d) => {
        const entry = d.data();
        if (entry.poNo && (entry.weightFOrderEntered !== undefined)) {
          weightMap[entry.poNo] = entry.weightFOrderEntered;
        }
      });
      setPoWeightMap(weightMap);
    } catch (error) {
      console.error("Error fetching master data:", error);
      alert("Error fetching data from Firebase");
    }
  };

  const fetchNextPos = async (drawingNumber) => {
    if (!drawingNumber) { setNextPos(1); return; }
    try {
      const q = query(collection(db, "entries"), orderBy("drawingNumber"));
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
      setItems((prev) => prev.map((item, idx) => ({ ...item, pos: maxPos + 1 + idx })));
    } catch (e) {
      console.error("Error fetching POS:", e);
    }
  };

  useEffect(() => { fetchMasterData(); }, []);
  useEffect(() => { fetchNextPos(headerData["Drawing Number"]); }, [headerData["Drawing Number"]]);

  // When PO No changes, auto-fill Weight f. Order if found
  useEffect(() => {
    const poNo = headerData["PO No"];
    if (poNo && poWeightMap[poNo] !== undefined) {
      setWeightFOrderEntered(String(poWeightMap[poNo]));
    }
  }, [headerData["PO No"], poWeightMap]);

  useEffect(() => {
    const total = items.reduce((sum, item) => sum + (parseFloat(item.totalWeight) || 0), 0);
    setWeightFOrderCalculated(total);
  }, [items]);

  const parseNum = (v) => parseFloat(v?.toString().replace(/,/g, "")) || 0;
  const formatNum = (n) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const calcDrgWeight = (quantity, singleWeight) => {
    const q = parseNum(quantity);
    const sw = parseNum(singleWeight);
    if (!q || !sw) return "";
    return (q * sw).toString();
  };

  // Plate: Length × Width × Size × Density × Quantity / 1,000,000
  // Non-plate: (Length / 1000) × Sectional Weight × Quantity
  const calcTotalWeight = (length, width, size, quantity, sectionalWeight, isPlate) => {
    const l = parseNum(length);
    const q = parseNum(quantity);
    if (isPlate) {
      const w = parseNum(width);
      const s = parseNum(size);
      if (!l || !w || !s || !q) return 0;
      return (l * w * s * DENSITY * q) / 1_000_000;
    } else {
      const sw = parseNum(sectionalWeight);
      if (!l || !sw || !q) return 0;
      return (l / 1000) * sw * q;
    }
  };

  const handleHeaderChange = (key, value) => {
    setHeaderData((prev) => ({ ...prev, [key]: value }));
  };

  const handleItemChange = (id, key, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [key]: value };

        if (key === "drgWeight") {
          updated.drgWeightManual = true;
        } else if ((key === "quantity" || key === "singleWeight") && !updated.drgWeightManual) {
          updated.drgWeight = calcDrgWeight(updated.quantity, updated.singleWeight);
        }

        if (key === "totalWeight") {
          updated.calcWeightManual = true;
          updated.totalWeight = parseNum(value);
        } else if (
          (key === "length" || key === "width" || key === "size" || key === "quantity" || key === "sectionalWeight" || key === "isPlate") &&
          !updated.calcWeightManual
        ) {
          updated.totalWeight = calcTotalWeight(
            updated.length, updated.width, updated.size, updated.quantity, updated.sectionalWeight, updated.isPlate
          );
        }

        return updated;
      })
    );
  };

  const resetDrgWeightAuto = (id) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, drgWeightManual: false, drgWeight: calcDrgWeight(item.quantity, item.singleWeight) };
      })
    );
  };

  const resetCalcWeightAuto = (id) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          calcWeightManual: false,
          totalWeight: calcTotalWeight(item.length, item.width, item.size, item.quantity, item.sectionalWeight, item.isPlate),
        };
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
        section: "",
        size: "",
        length: "",
        width: "",
        sectionalWeight: "",
        singleWeight: "",
        drgWeight: "",
        drgWeightManual: false,
        calcWeightManual: false,
        isPlate: true,
        totalWeight: 0,
      },
    ]);
  };

  const removeRow = (id) => {
    if (items.length === 1) return;
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== id);
      return filtered.map((item, idx) => ({ ...item, pos: nextPos + idx }));
    });
  };

  const saveValueIfNew = async (collectionName, value, options, setOptions) => {
    const trimmed = (value || "").trim();
    if (!trimmed) return;
    const exists = options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
    if (exists) return;
    try {
      const docRef = await addDoc(collection(db, collectionName), { value: trimmed });
      const newOption = { id: docRef.id, value: trimmed, isManual: true };
      setOptions((prev) => [...prev, newOption].sort((a, b) => a.value.localeCompare(b.value)));
    } catch (error) {
      console.error("Error adding value:", error);
    }
  };

  const handleDeleteValue = async (collectionName, option, setOptions, fieldKey) => {
    if (!window.confirm(`Delete "${option.value}"?`)) return;
    try {
      await deleteDoc(doc(db, collectionName, option.id));
      setOptions((prev) => prev.filter((o) => o.id !== option.id));
      if (fieldKey) {
        setHeaderData((prev) =>
          prev[fieldKey] === option.value ? { ...prev, [fieldKey]: "" } : prev
        );
      }
      if (["sections", "thicknesses", "lengths", "widths"].includes(collectionName)) {
        const itemKey =
          collectionName === "sections" ? "section" :
          collectionName === "thicknesses" ? "size" :
          collectionName === "lengths" ? "length" : "width";
        setItems((prev) =>
          prev.map((item) =>
            item[itemKey] === option.value ? { ...item, [itemKey]: "" } : item
          )
        );
      }
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Error deleting. Please try again.");
    }
  };

  const renderAutocomplete = (label, value, onChange, options, collectionName, setOptions, fieldKey = null) => {
    const fieldId = `header-${collectionName}`;
    const isActive = activeSuggestion === fieldId;
    const filtered = options.filter((o) =>
      o.value.toLowerCase().includes((value || "").toLowerCase())
    );

    return (
      <div className="entry-input" style={{ position: "relative" }}>
        <label>{label} ({options.length})</label>
        <input
          type="text"
          className="autocomplete-field"
          value={value || ""}
          onChange={(e) => onChange({ target: { value: e.target.value } })}
          onFocus={() => setActiveSuggestion(fieldId)}
          onBlur={() => {
            saveValueIfNew(collectionName, value, options, setOptions);
            setTimeout(() => setActiveSuggestion(null), 150);
          }}
          autoComplete="off"
        />
        {isActive && filtered.length > 0 && (
          <div className="suggestion-list">
            {filtered.map((opt) => (
              <div key={opt.id} className="suggestion-item">
                <span
                  className="suggestion-text"
                  onMouseDown={() => {
                    onChange({ target: { value: opt.value } });
                    setActiveSuggestion(null);
                  }}
                >
                  {opt.value}
                </span>
                <button
                  type="button"
                  className="suggestion-delete"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleDeleteValue(collectionName, opt, setOptions, fieldKey);
                  }}
                  title={`Delete "${opt.value}"`}
                >
                  <HiTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderRowAutocomplete = (item, fieldKey, label, options, collectionName, setOptions) => {
    const fieldId = `${fieldKey}-${item.id}`;
    const isActive = activeSuggestion === fieldId;
    const value = item[fieldKey] || "";
    const filtered = options.filter((o) =>
      o.value.toLowerCase().includes(value.toLowerCase())
    );

    return (
      <div className="entry-input" style={{ position: "relative", minWidth: "180px" }}>
        <label>{label} ({options.length})</label>
        <input
          type="text"
          className="autocomplete-field"
          value={value}
          onChange={(e) => handleItemChange(item.id, fieldKey, e.target.value)}
          onFocus={() => setActiveSuggestion(fieldId)}
          onBlur={() => {
            saveValueIfNew(collectionName, value, options, setOptions);
            setTimeout(() => setActiveSuggestion(null), 150);
          }}
          autoComplete="off"
        />
        {isActive && filtered.length > 0 && (
          <div className="suggestion-list">
            {filtered.map((opt) => (
              <div key={opt.id} className="suggestion-item">
                <span
                  className="suggestion-text"
                  onMouseDown={() => {
                    handleItemChange(item.id, fieldKey, opt.value);
                    setActiveSuggestion(null);
                  }}
                >
                  {opt.value}
                </span>
                <button
                  type="button"
                  className="suggestion-delete"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleDeleteValue(collectionName, opt, setOptions, null);
                  }}
                  title={`Delete "${opt.value}"`}
                >
                  <HiTrash />
                </button>
              </div>
            ))}
          </div>
        )}
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
          section: i.section,
          size: parseNum(i.size),        // renamed from thickness
          length: parseNum(i.length),
          width: parseNum(i.width),
          sectionalWeight: parseNum(i.sectionalWeight),
          singleWeight: parseNum(i.singleWeight),
          drgWeight: parseNum(i.drgWeight),
          totalWeight: parseNum(i.totalWeight),
          isPlate: i.isPlate,
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

      <div className="form-wrapper">
        <h3>Project Details</h3>
        <div className="entry-grid">
          {renderAutocomplete("PO No", headerData["PO No"], (e) => handleHeaderChange("PO No", e.target.value), allPONos, "poNos", setAllPONos, "PO No")}
          {renderAutocomplete("Equipment", headerData["Equipment"], (e) => handleHeaderChange("Equipment", e.target.value), allEquipments, "equipments", setAllEquipments, "Equipment")}
          <div className="entry-input">
            <label>Weight f. Order (KG) - Entered</label>
            <input type="number" step="0.001" value={weightFOrderEntered} onChange={(e) => setWeightFOrderEntered(e.target.value)} />
          </div>
          {renderAutocomplete("Part Name", headerData["Part Name"], (e) => handleHeaderChange("Part Name", e.target.value), allPartNames, "partNames", setAllPartNames, "Part Name")}
          {renderAutocomplete("Drawing Number", headerData["Drawing Number"], (e) => handleHeaderChange("Drawing Number", e.target.value), allDrawingNumbers, "drawingNumbers", setAllDrawingNumbers, "Drawing Number")}
        </div>

        <hr />
        <h3>Parts / Items</h3>

        {items.map((item, index) => (
          <div key={item.id} className="section-card">
            {items.length > 1 && (
              <button className="remove-row-btn" onClick={() => removeRow(item.id)} type="button">
                <HiTrash /> Remove
              </button>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "8px" }}>
              <h4 style={{ margin: 0 }}>Row #{index + 1} — POS: {String(item.pos).padStart(3, "0")}</h4>
              {/* Plate / Non-Plate toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#555" }}>Type:</span>
                <button
                  type="button"
                  onClick={() => handleItemChange(item.id, "isPlate", true)}
                  style={{
                    padding: "3px 12px", fontSize: "12px", borderRadius: "4px", cursor: "pointer",
                    background: item.isPlate ? "#2980b9" : "#eee",
                    color: item.isPlate ? "#fff" : "#333",
                    border: "1px solid " + (item.isPlate ? "#2980b9" : "#ccc"),
                    fontWeight: item.isPlate ? 700 : 400,
                  }}
                >
                  Plate
                </button>
                <button
                  type="button"
                  onClick={() => handleItemChange(item.id, "isPlate", false)}
                  style={{
                    padding: "3px 12px", fontSize: "12px", borderRadius: "4px", cursor: "pointer",
                    background: !item.isPlate ? "#27ae60" : "#eee",
                    color: !item.isPlate ? "#fff" : "#333",
                    border: "1px solid " + (!item.isPlate ? "#27ae60" : "#ccc"),
                    fontWeight: !item.isPlate ? 700 : 400,
                  }}
                >
                  Section
                </button>
              </div>
            </div>

            <div className="section-grid">
              <div className="entry-input">
                <label>Quantity</label>
                <input type="number" value={item.quantity} onChange={(e) => handleItemChange(item.id, "quantity", e.target.value)} />
              </div>

              {/* Section */}
              {renderRowAutocomplete(item, "section", "Section", allSections, "sections", setAllSections)}

              {/* Size (renamed from Thickness) */}
              {renderRowAutocomplete(item, "size", "Size (mm)", allSizes, "thicknesses", setAllSizes)}

              {/* Length */}
              {renderRowAutocomplete(item, "length", "Length (mm)", allLengths, "lengths", setAllLengths)}

              {/* Width */}
              {renderRowAutocomplete(item, "width", "Width (mm)", allWidths, "widths", setAllWidths)}

              {/* Sectional Weight — new field */}
              <div className="entry-input">
                <label>Sectional Weight (kg/m)</label>
                <input
                  type="number" step="0.001"
                  value={item.sectionalWeight}
                  onChange={(e) => handleItemChange(item.id, "sectionalWeight", e.target.value)}
                />
              </div>

              <div className="entry-input">
                <label>Single Weight (kg)</label>
                <input type="number" step="0.001" value={item.singleWeight} onChange={(e) => handleItemChange(item.id, "singleWeight", e.target.value)} />
              </div>

              {/* DRG Weight */}
              <div className="entry-input">
                <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  DRG Weight (kg)
                  <span style={{ fontSize: "11px", color: item.drgWeightManual ? "#e67e22" : "#27ae60", fontWeight: 600 }}>
                    {item.drgWeightManual ? "✎ Manual" : ""}
                  </span>
                  {item.drgWeightManual && (
                    <button type="button" onClick={() => resetDrgWeightAuto(item.id)}
                      style={{ fontSize: "10px", padding: "1px 6px", background: "#eee", border: "1px solid #ccc", borderRadius: "3px", cursor: "pointer" }}>
                      Reset
                    </button>
                  )}
                </label>
                <input
                  type="number" step="0.001"
                  value={item.drgWeight}
                  onChange={(e) => handleItemChange(item.id, "drgWeight", e.target.value)}
                  style={{ borderColor: item.drgWeightManual ? "#e67e22" : undefined }}
                />
              </div>

              {/* Calculated Weight */}
              <div className="entry-input">
                <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  Calculated Weight (kg)
                  <span style={{ fontSize: "11px", color: item.calcWeightManual ? "#e67e22" : "#27ae60", fontWeight: 600 }}>
                    {item.calcWeightManual ? "✎ Manual" : ""}
                  </span>
                  {item.calcWeightManual && (
                    <button type="button" onClick={() => resetCalcWeightAuto(item.id)}
                      style={{ fontSize: "10px", padding: "1px 6px", background: "#eee", border: "1px solid #ccc", borderRadius: "3px", cursor: "pointer" }}>
                      Reset
                    </button>
                  )}
                </label>
                <input
                  type="number" step="0.001"
                  value={formatNum(parseNum(item.totalWeight))}
                  onChange={(e) => handleItemChange(item.id, "totalWeight", e.target.value)}
                  style={{ borderColor: item.calcWeightManual ? "#e67e22" : undefined }}
                />
              </div>
            </div>
          </div>
        ))}

        <button className="add-section-btn" onClick={addRow} type="button">
          <HiPlus /> Add Another Row
        </button>

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

        <button className="entry-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Saving..." : "Save Entry"}
        </button>
      </div>
    </div>
  );
}