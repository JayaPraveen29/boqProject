import { useState, useEffect } from "react";
import { HiPlus, HiTrash, HiDocumentDuplicate } from "react-icons/hi2";
import {
  db, collection, addDoc, getDocs, query, orderBy, deleteDoc, doc
} from "../../dataClient";
import "./EntryPage.css";

const DENSITY = 7.85;

export default function EntryPage() {
  const [loading, setLoading] = useState(false);

  const [headerData, setHeaderData] = useState({
    "POC No": "",
    "Equipment": "",
    "Part Name": "",
    "Drawing Number": "",
  });

  const [weightFOrderEntered, setWeightFOrderEntered] = useState("");
  const [weightFOrderCalculated, setWeightFOrderCalculated] = useState(0);

  const [allPOCNos, setAllPOCNos]               = useState([]);
  const [allEquipments, setAllEquipments]         = useState([]);
  const [allPartNames, setAllPartNames]           = useState([]);
  const [allDrawingNumbers, setAllDrawingNumbers] = useState([]);
  const [allSections, setAllSections]             = useState([]);
  const [allSizes, setAllSizes]                   = useState([]);
  const [allLengths, setAllLengths]               = useState([]);
  const [allWidths, setAllWidths]                 = useState([]);

  const [sectionSizeRelations, setSectionSizeRelations]           = useState([]);
  const [sectionSizeLengthRelations, setSectionSizeLengthRelations] = useState([]);
  const [sectionSizeWidthRelations, setSectionSizeWidthRelations]   = useState([]);
  // Each record: { id, sectionId, sizeId, sectionalWeight }
  const [sectionSectionalWeights, setSectionSectionalWeights]     = useState([]);

  const [activeSuggestion, setActiveSuggestion] = useState(null);
  const [customInputs, setCustomInputs]         = useState({});

  const [items, setItems] = useState([{
    id: Date.now(),
    pos: 1,
    quantity: "",
    section: "",
    size: "",
    length: "",
    width: "",
    sectionalWeight: "",
    unitWeight: "",
    unitWeightManual: false,
    singleWeight: "",
    drgWeight: "",
    drgWeightManual: false,
    calcWeightManual: false,
    isPlate: true,
    totalWeight: "",
  }]);

  const [nextPos, setNextPos] = useState(1);
  const [manualPosIds, setManualPosIds] = useState(new Set());
  const [pocWeightMap, setPocWeightMap] = useState({});
  // ─── Copy from Entry modal state ──────────────────────────────────────────
  const [copyModal, setCopyModal] = useState({
    open: false,
    pocFilter: "",
    equipmentFilter: "",
    entries: [],
    loading: false,
    selected: null,
    copyWhat: { items: true },
  });


  // ─── Fetch all master data + relation tables ───────────────────────────────
  const fetchMasterData = async () => {
    try {
      const [pocNoSnap, eqSnap, pnSnap, dnSnap, secSnap, sizeSnap, lenSnap, widSnap] = await Promise.all([
        getDocs(collection(db, "poNos")),
        getDocs(collection(db, "equipments")),
        getDocs(collection(db, "partNames")),
        getDocs(collection(db, "drawingNumbers")),
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "thicknesses")),
        getDocs(collection(db, "lengths")),
        getDocs(collection(db, "widths")),
      ]);

      const mapSnap = (snap) =>
        snap.docs
          .map((d) => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true }))
          .filter((i) => i.value)
          .sort((a, b) => a.value.localeCompare(b.value));

      setAllPOCNos(mapSnap(pocNoSnap));
      setAllEquipments(mapSnap(eqSnap));
      setAllPartNames(mapSnap(pnSnap));
      setAllDrawingNumbers(mapSnap(dnSnap));
      setAllSections(mapSnap(secSnap));
      setAllSizes(mapSnap(sizeSnap));
      setAllLengths(mapSnap(lenSnap));
      setAllWidths(mapSnap(widSnap));

      const [ssRelSnap, sslRelSnap, sswRelSnap, swSnap, entriesSnap] = await Promise.all([
        getDocs(collection(db, "sectionSizeRelations")),
        getDocs(collection(db, "sectionSizeLengthRelations")),
        getDocs(collection(db, "sectionSizeWidthRelations")),
        getDocs(collection(db, "sectionSectionalWeights")),
        getDocs(collection(db, "entries")),
      ]);

      setSectionSizeRelations(ssRelSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setSectionSizeLengthRelations(sslRelSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setSectionSizeWidthRelations(sswRelSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Each doc now stores { sectionId, sizeId, sectionalWeight }
      setSectionSectionalWeights(swSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Build pocNo -> weightFOrderEntered map
      const weightMap = {};
      entriesSnap.docs.forEach((d) => {
        const entry = d.data();
        const pocKey = entry.pocNo || entry.poNo;
        if (pocKey && entry.weightFOrderEntered !== undefined) {
          weightMap[pocKey] = entry.weightFOrderEntered;
        }
      });
      setPocWeightMap(weightMap);
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
          data.items.forEach((item) => { if (item.pos > maxPos) maxPos = item.pos; });
        }
      });
      setNextPos(maxPos + 1);
      // Only auto-assign POS to rows the user hasn't manually edited yet.
      // This prevents a late-resolving fetch (e.g. triggered by an earlier
      // keystroke while typing the Drawing Number) from silently overwriting
      // a POS value the user already typed in.
      setItems((prev) => {
        let autoIdx = 0;
        return prev.map((item) => {
          if (manualPosIds.has(item.id)) return item;
          const computedPos = maxPos + 1 + autoIdx;
          autoIdx += 1;
          return { ...item, pos: computedPos };
        });
      });
    } catch (e) {
      console.error("Error fetching POS:", e);
    }
  };

  useEffect(() => { fetchMasterData(); }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchNextPos(headerData["Drawing Number"]);
    }, 400);
    return () => clearTimeout(timer);
  }, [headerData["Drawing Number"]]);

  useEffect(() => {
    const pocNo = headerData["POC No"];
    if (pocNo && pocWeightMap[pocNo] !== undefined) {
      setWeightFOrderEntered(String(pocWeightMap[pocNo]));
    }
  }, [headerData["POC No"], pocWeightMap]);

  useEffect(() => {
    const total = items.reduce((sum, item) => sum + (parseFloat(item.totalWeight) || 0), 0);
    setWeightFOrderCalculated(total);
  }, [items]);

  // ─── Relation helpers ──────────────────────────────────────────────────────
  const getAvailableSizes = (selectedSection) => {
    if (!selectedSection) return allSizes;
    const sectionObj = allSections.find((s) => s.value === selectedSection);
    if (!sectionObj) return allSizes;
    const relatedSizeIds = sectionSizeRelations
      .filter((rel) => rel.sectionId === sectionObj.id)
      .map((rel) => rel.sizeId);
    if (relatedSizeIds.length === 0) return allSizes;
    return allSizes.filter((s) => relatedSizeIds.includes(s.id));
  };

  const getAvailableLengths = (selectedSection, selectedSize) => {
    if (!selectedSection || !selectedSize) return allLengths;
    const sectionObj = allSections.find((s) => s.value === selectedSection);
    const sizeObj    = allSizes.find((s) => s.value === selectedSize);
    if (!sectionObj || !sizeObj) return allLengths;
    const relatedLengthIds = sectionSizeLengthRelations
      .filter((rel) => rel.sectionId === sectionObj.id && rel.sizeId === sizeObj.id)
      .map((rel) => rel.lengthId);
    if (relatedLengthIds.length === 0) return allLengths;
    return allLengths.filter((l) => relatedLengthIds.includes(l.id));
  };

  const getAvailableWidths = (selectedSection, selectedSize) => {
    if (!selectedSection || !selectedSize) return allWidths;
    const sectionObj = allSections.find((s) => s.value === selectedSection);
    const sizeObj    = allSizes.find((s) => s.value === selectedSize);
    if (!sectionObj || !sizeObj) return allWidths;
    const relatedWidthIds = sectionSizeWidthRelations
      .filter((rel) => rel.sectionId === sectionObj.id && rel.sizeId === sizeObj.id)
      .map((rel) => rel.widthId);
    if (relatedWidthIds.length === 0) return allWidths;
    return allWidths.filter((w) => relatedWidthIds.includes(w.id));
  };

  // ─── UPDATED: look up sectional weight by section + size ──────────────────
  const getSectionalWeight = (selectedSection, selectedSize) => {
    if (!selectedSection) return "";
    const sectionObj = allSections.find((s) => s.value === selectedSection);
    if (!sectionObj) return "";

    if (selectedSize) {
      // Prefer the more-specific section+size record
      const sizeObj = allSizes.find((s) => s.value === selectedSize);
      if (sizeObj) {
        const rel = sectionSectionalWeights.find(
          (r) => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id
        );
        if (rel) return String(rel.sectionalWeight);
      }
    }

    // Fall back to a section-only record (sizeId absent / undefined) for
    // backward compatibility with data saved before this change.
    const fallback = sectionSectionalWeights.find(
      (r) => r.sectionId === sectionObj.id && !r.sizeId
    );
    return fallback ? String(fallback.sectionalWeight) : "";
  };

  const saveSectionSizeRelation = async (sectionValue, sizeValue) => {
    if (!sectionValue?.trim() || !sizeValue?.trim()) return;
    const sectionObj = allSections.find((s) => s.value === sectionValue);
    const sizeObj    = allSizes.find((s) => s.value === sizeValue);
    if (!sectionObj || !sizeObj) return;
    const exists = sectionSizeRelations.find(
      (r) => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id
    );
    if (exists) return;
    try {
      const docRef = await addDoc(collection(db, "sectionSizeRelations"), {
        sectionId: sectionObj.id,
        sizeId: sizeObj.id,
      });
      setSectionSizeRelations((prev) => [...prev, { id: docRef.id, sectionId: sectionObj.id, sizeId: sizeObj.id }]);
    } catch (e) {
      console.error("Error saving section-size relation:", e);
    }
  };

  const saveSectionSizeLengthRelation = async (sectionValue, sizeValue, lengthValue) => {
    if (!sectionValue?.trim() || !sizeValue?.trim() || !lengthValue?.trim()) return;
    const sectionObj = allSections.find((s) => s.value === sectionValue);
    const sizeObj    = allSizes.find((s) => s.value === sizeValue);
    const lengthObj  = allLengths.find((l) => l.value === lengthValue);
    if (!sectionObj || !sizeObj || !lengthObj) return;
    const exists = sectionSizeLengthRelations.find(
      (r) => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id && r.lengthId === lengthObj.id
    );
    if (exists) return;
    try {
      const docRef = await addDoc(collection(db, "sectionSizeLengthRelations"), {
        sectionId: sectionObj.id, sizeId: sizeObj.id, lengthId: lengthObj.id,
      });
      setSectionSizeLengthRelations((prev) => [...prev, { id: docRef.id, sectionId: sectionObj.id, sizeId: sizeObj.id, lengthId: docRef.id }]);
    } catch (e) {
      console.error("Error saving section-size-length relation:", e);
    }
  };

  const saveSectionSizeWidthRelation = async (sectionValue, sizeValue, widthValue) => {
    if (!sectionValue?.trim() || !sizeValue?.trim() || !widthValue?.trim()) return;
    const sectionObj = allSections.find((s) => s.value === sectionValue);
    const sizeObj    = allSizes.find((s) => s.value === sizeValue);
    const widthObj   = allWidths.find((w) => w.value === widthValue);
    if (!sectionObj || !sizeObj || !widthObj) return;
    const exists = sectionSizeWidthRelations.find(
      (r) => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id && r.widthId === widthObj.id
    );
    if (exists) return;
    try {
      const docRef = await addDoc(collection(db, "sectionSizeWidthRelations"), {
        sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: widthObj.id,
      });
      setSectionSizeWidthRelations((prev) => [...prev, { id: docRef.id, sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: widthObj.id }]);
    } catch (e) {
      console.error("Error saving section-size-width relation:", e);
    }
  };

  // ─── UPDATED: save sectional weight keyed by section + size ───────────────
  const saveSectionalWeight = async (sectionValue, sizeValue, weight) => {
    if (!sectionValue?.trim() || !weight) return;
    const sectionObj = allSections.find((s) => s.value === sectionValue);
    if (!sectionObj) return;

    // Resolve sizeId only when a size is provided
    let sizeId = null;
    if (sizeValue?.trim()) {
      const sizeObj = allSizes.find((s) => s.value === sizeValue);
      if (sizeObj) sizeId = sizeObj.id;
    }

    // Find existing record matching section + size (or section-only if no size)
    const existing = sectionSectionalWeights.find((r) => {
      const sectionMatch = r.sectionId === sectionObj.id;
      const sizeMatch    = sizeId ? r.sizeId === sizeId : !r.sizeId;
      return sectionMatch && sizeMatch;
    });

    const newData = {
      sectionId: sectionObj.id,
      ...(sizeId ? { sizeId } : {}),
      sectionalWeight: parseNum(weight),
    };

    try {
      if (existing) {
        await deleteDoc(doc(db, "sectionSectionalWeights", existing.id));
        const docRef = await addDoc(collection(db, "sectionSectionalWeights"), newData);
        setSectionSectionalWeights((prev) => [
          ...prev.filter((r) => r.id !== existing.id),
          { id: docRef.id, ...newData },
        ]);
      } else {
        const docRef = await addDoc(collection(db, "sectionSectionalWeights"), newData);
        setSectionSectionalWeights((prev) => [...prev, { id: docRef.id, ...newData }]);
      }
    } catch (e) {
      console.error("Error saving sectional weight:", e);
    }
  };

  // ─── Calculations ──────────────────────────────────────────────────────────
  const parseNum = (v) => parseFloat(v?.toString().replace(/,/g, "")) || 0;
  const formatNum = (n) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const calcDrgWeight = (quantity, singleWeight) => {
    const q = parseNum(quantity), sw = parseNum(singleWeight);
    if (!q || !sw) return "";
    return (q * sw).toString();
  };

  const calcUnitWeight = (length, width, size, sectionalWeight, isPlate) => {
    const l = parseNum(length);
    if (isPlate) {
      const w = parseNum(width), s = parseNum(size);
      if (!l || !w || !s) return "";
      return (s * DENSITY * l * w) / 1_000_000;
    } else {
      const sw = parseNum(sectionalWeight);
      if (!l || !sw) return "";
      return (l / 1000) * sw;
    }
  };

  const calcTotalWeight = (length, width, size, quantity, sectionalWeight, isPlate) => {
    const q = parseNum(quantity);
    const uw = parseNum(calcUnitWeight(length, width, size, sectionalWeight, isPlate));
    if (!q || !uw) return "";
    return uw * q;
  };

  // ─── Item change handler ───────────────────────────────────────────────────
  const handleItemChange = (id, key, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        let updated = { ...item, [key]: value };

        // When section changes → auto-fill sectional weight by section+size, reset downstream
        if (key === "section" && value !== item.section) {
          const sw = getSectionalWeight(value, updated.size);
          updated.sectionalWeight = sw;
          updated.size = "";
          updated.length = "";
          updated.width = "";
          if (!updated.unitWeightManual) {
            updated.unitWeight = calcUnitWeight("", "", "", sw, updated.isPlate);
          }
          if (!updated.calcWeightManual) {
            updated.totalWeight = calcTotalWeight("", "", "", updated.quantity, sw, updated.isPlate);
          }
        }

        // When size changes → auto-fill sectional weight by section+size, reset length/width
        if (key === "size" && value !== item.size) {
          updated.length = "";
          updated.width = "";
          if (!updated.unitWeightManual) {
            // Attempt to auto-fill sectional weight for the new section+size combo
            const sw = getSectionalWeight(updated.section, value);
            if (sw) updated.sectionalWeight = sw;
          }
        }

        // DRG weight
        if (key === "drgWeight") {
          updated.drgWeightManual = true;
        } else if ((key === "quantity" || key === "singleWeight") && !updated.drgWeightManual) {
          updated.drgWeight = calcDrgWeight(updated.quantity, updated.singleWeight);
        }

        // Unit weight (Calc Single Weight)
        if (key === "unitWeight") {
          updated.unitWeightManual = true;
        } else if (
          ["length", "width", "size", "sectionalWeight", "isPlate"].includes(key) &&
          !updated.unitWeightManual
        ) {
          updated.unitWeight = calcUnitWeight(
            updated.length, updated.width, updated.size, updated.sectionalWeight, updated.isPlate
          );
        }

        // Total weight (Calculated Weight)
        if (key === "totalWeight") {
          updated.calcWeightManual = true;
          updated.totalWeight = value;
        } else if (
          ["length", "width", "size", "quantity", "sectionalWeight", "isPlate"].includes(key) &&
          !updated.calcWeightManual
        ) {
          updated.totalWeight = calcTotalWeight(
            updated.length, updated.width, updated.size, updated.quantity, updated.sectionalWeight, updated.isPlate
          );
        }

        // Sync manual unit weight edit → total weight
        if (key === "unitWeight" && !updated.calcWeightManual) {
          const q = parseNum(updated.quantity);
          const uw = parseNum(value);
          updated.totalWeight = (q && uw) ? uw * q : "";
        }

        return updated;
      })
    );
  };

  const resetUnitWeightAuto = (id) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const uw = calcUnitWeight(item.length, item.width, item.size, item.sectionalWeight, item.isPlate);
      return { ...item, unitWeightManual: false, unitWeight: uw };
    }));
  };

  const resetDrgWeightAuto = (id) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      return { ...item, drgWeightManual: false, drgWeight: calcDrgWeight(item.quantity, item.singleWeight) };
    }));
  };

  const resetCalcWeightAuto = (id) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        calcWeightManual: false,
        totalWeight: calcTotalWeight(item.length, item.width, item.size, item.quantity, item.sectionalWeight, item.isPlate),
      };
    }));
  };

  const addRow = () => {
    const lastPos = items.length > 0 ? items[items.length - 1].pos : nextPos - 1;
    const newId = Date.now();
    setItems((prev) => [...prev, {
      id: newId, pos: lastPos + 1, quantity: "", section: "", size: "",
      length: "", width: "", sectionalWeight: "", unitWeight: "", unitWeightManual: false,
      singleWeight: "", drgWeight: "", drgWeightManual: false, calcWeightManual: false,
      isPlate: true, totalWeight: "",
    }]);
    // Protect this row's computed POS from being overwritten by a later
    // (possibly stale) fetchNextPos auto-assignment.
    setManualPosIds((prev) => {
      const next = new Set(prev);
      next.add(newId);
      return next;
    });
  };

  // Manual POS edit: changing a row's POS renumbers every row BELOW it
  // sequentially from the new value (e.g. change a row to 26 → the next row
  // becomes 27, the one after 28, and so on). Rows above the edited one, and
  // the row's other fields, are left untouched.
  const handlePosChange = (id, value) => {
    const raw = value === "" ? "" : parseInt(value, 10);
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;

      const touchedIds = [];
      const updated = prev.map((item, i) => {
        if (i < idx) return item;
        if (i === idx) { touchedIds.push(item.id); return { ...item, pos: raw }; }
        // While the field is empty or not yet a valid number (user still
        // typing), don't cascade — just wait for a real value.
        if (raw === "" || isNaN(raw)) return item;
        touchedIds.push(item.id);
        return { ...item, pos: raw + (i - idx) };
      });

      setManualPosIds((prevIds) => {
        const next = new Set(prevIds);
        touchedIds.forEach((tid) => next.add(tid));
        return next;
      });

      return updated;
    });
  };

  const removeRow = (id) => {
    if (items.length === 1) return;
    // Just drop the row — do NOT renumber the rest. Renumbering here would
    // overwrite any manually-set POS values from handlePosChange above.
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // ─── Autocomplete helpers ──────────────────────────────────────────────────
  const handleHeaderChange = (key, value) => {
    setHeaderData((prev) => ({ ...prev, [key]: value }));
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

  const toggleCustomInput = (rowId, type) => {
    const key = `${rowId}-${type}`;
    setCustomInputs((prev) => ({ ...prev, [key]: { show: !prev[key]?.show, value: prev[key]?.value || "" } }));
  };
  const setCustomValue = (rowId, type, value) => {
    const key = `${rowId}-${type}`;
    setCustomInputs((prev) => ({ ...prev, [key]: { ...prev[key], value } }));
  };
  const getCustomState = (rowId, type) => customInputs[`${rowId}-${type}`] || { show: false, value: "" };

  // ─── Render autocomplete (header fields) ──────────────────────────────────
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
                <span className="suggestion-text" onMouseDown={() => { onChange({ target: { value: opt.value } }); setActiveSuggestion(null); }}>
                  {opt.value}
                </span>
                <button type="button" className="suggestion-delete"
                  onMouseDown={(e) => { e.preventDefault(); handleDeleteValue(collectionName, opt, setOptions, fieldKey); }}
                  title={`Delete "${opt.value}"`}>
                  <HiTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ─── Render dropdown with +Add for item rows ───────────────────────────────
  const renderRowDropdown = (item, fieldKey, label, options, collectionName, setOptions) => {
    const customState = getCustomState(item.id, fieldKey);
    const value = item[fieldKey] || "";

    const handleAdd = async () => {
      const trimmed = customState.value.trim();
      if (!trimmed) { alert("Please enter a value!"); return; }

      const existing = options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        handleItemChange(item.id, fieldKey, existing.value);
        if (fieldKey === "size" && item.section) {
          await saveSectionSizeRelation(item.section, existing.value);
        }
        if (fieldKey === "length" && item.section && item.size) {
          await saveSectionSizeLengthRelation(item.section, item.size, existing.value);
        }
        if (fieldKey === "width" && item.section && item.size) {
          await saveSectionSizeWidthRelation(item.section, item.size, existing.value);
        }
        toggleCustomInput(item.id, fieldKey);
        return;
      }

      try {
        const docRef = await addDoc(collection(db, collectionName), { value: trimmed });
        const newOpt = { id: docRef.id, value: trimmed, isManual: true };
        setOptions((prev) => [...prev, newOpt].sort((a, b) => a.value.localeCompare(b.value)));
        handleItemChange(item.id, fieldKey, trimmed);
        if (fieldKey === "size" && item.section) {
          const sectionObj = allSections.find((s) => s.value === item.section);
          if (sectionObj) {
            const relDocRef = await addDoc(collection(db, "sectionSizeRelations"), { sectionId: sectionObj.id, sizeId: docRef.id });
            setSectionSizeRelations((prev) => [...prev, { id: relDocRef.id, sectionId: sectionObj.id, sizeId: docRef.id }]);
          }
        }
        if (fieldKey === "length" && item.section && item.size) {
          const sectionObj = allSections.find((s) => s.value === item.section);
          const sizeObj    = allSizes.find((s) => s.value === item.size);
          if (sectionObj && sizeObj) {
            const relDocRef = await addDoc(collection(db, "sectionSizeLengthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, lengthId: docRef.id });
            setSectionSizeLengthRelations((prev) => [...prev, { id: relDocRef.id, sectionId: sectionObj.id, sizeId: sizeObj.id, lengthId: docRef.id }]);
          }
        }
        if (fieldKey === "width" && item.section && item.size) {
          const sectionObj = allSections.find((s) => s.value === item.section);
          const sizeObj    = allSizes.find((s) => s.value === item.size);
          if (sectionObj && sizeObj) {
            const relDocRef = await addDoc(collection(db, "sectionSizeWidthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: docRef.id });
            setSectionSizeWidthRelations((prev) => [...prev, { id: relDocRef.id, sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: docRef.id }]);
          }
        }
        toggleCustomInput(item.id, fieldKey);
      } catch (e) {
        console.error(`Error adding ${fieldKey}:`, e);
        alert(`Error adding value. Please try again.`);
      }
    };

    return (
      <div className="entry-input">
        <label>{label} ({options.length})</label>
        <div className="dropdown-container">
          <div className="dropdown-row">
            <select
              className="dropdown-select"
              value={value}
              onChange={(e) => {
                handleItemChange(item.id, fieldKey, e.target.value);
                if (fieldKey === "size" && e.target.value && item.section) {
                  saveSectionSizeRelation(item.section, e.target.value);
                }
                if (fieldKey === "length" && e.target.value && item.section && item.size) {
                  saveSectionSizeLengthRelation(item.section, item.size, e.target.value);
                }
                if (fieldKey === "width" && e.target.value && item.section && item.size) {
                  saveSectionSizeWidthRelation(item.section, item.size, e.target.value);
                }
              }}
            >
              <option value="">Select {label}</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.value}>{opt.value}</option>
              ))}
            </select>
            <button className="btn-toggle-custom" type="button" onClick={() => toggleCustomInput(item.id, fieldKey)}>
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
                  onChange={(e) => setCustomValue(item.id, fieldKey, e.target.value)}
                  placeholder={`Enter new ${label.toLowerCase()}`}
                  onKeyPress={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
                <button className="btn-add-custom" type="button" onClick={handleAdd}>Add</button>
              </div>
              <div className="manual-values-list">
                <div className="custom-values-header">Manually Created Values</div>
                {options.filter((o) => o.isManual).length === 0 ? (
                  <div className="no-manual-values">No manually created values yet</div>
                ) : (
                  options.filter((o) => o.isManual).map((opt) => (
                    <div key={opt.id} className="manual-value-item">
                      <span className="manual-value-text">{opt.value}</span>
                      <button className="btn-delete-value" type="button"
                        onClick={() => handleDeleteValue(collectionName, opt, setOptions, null)}>
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


  // ─── Copy from Entry helpers ───────────────────────────────────────────────
  const openCopyModal = () => {
    setCopyModal((m) => ({ ...m, open: true, entries: [], selected: null, pocFilter: "", equipmentFilter: "" }));
    // auto-fetch all entries immediately on open
    fetchEntriesForCopy("", "");
  };

  const closeCopyModal = () => {
    setCopyModal((m) => ({ ...m, open: false }));
  };

  // Accepts filter values explicitly to avoid stale-closure issues
  const fetchEntriesForCopy = async (pocFilterVal, eqFilterVal) => {
    const pocF = (pocFilterVal ?? "").trim().toLowerCase();
    const eqF  = (eqFilterVal  ?? "").trim().toLowerCase();
    setCopyModal((m) => ({ ...m, loading: true, entries: [], selected: null }));
    try {
      const snap = await getDocs(query(collection(db, "entries"), orderBy("createdAt", "desc")));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const filtered = all.filter((e) => {
        const pocMatch = !pocF || (e.pocNo || e.poNo || "").toLowerCase().includes(pocF);
        const eqMatch  = !eqF  || (e.equipment || "").toLowerCase().includes(eqF);
        return pocMatch && eqMatch;
      });
      setCopyModal((m) => ({ ...m, entries: filtered, loading: false }));
    } catch (err) {
      console.error("Error fetching entries for copy:", err);
      setCopyModal((m) => ({ ...m, loading: false }));
      alert("Error fetching entries.");
    }
  };

  const applyCopy = () => {
    const { selected, copyWhat } = copyModal;
    if (!selected) return;

    if (copyWhat.items && selected.items && selected.items.length > 0) {
      const basePos = nextPos;
      const newItems = selected.items.map((si, idx) => ({
        id: Date.now() + idx,
        pos: basePos + idx,
        quantity: si.quantity ?? "",
        section: si.section ?? "",
        size: si.size !== undefined ? String(si.size) : "",
        length: si.length ?? "",
        width: si.width ?? "",
        sectionalWeight: si.sectionalWeight ?? "",
        unitWeight: si.unitWeight ?? "",
        unitWeightManual: false,
        singleWeight: si.singleWeight ?? "",
        drgWeight: si.drgWeight ?? "",
        drgWeightManual: false,
        calcWeightManual: false,
        isPlate: si.isPlate !== undefined ? si.isPlate : true,
        totalWeight: si.totalWeight ?? "",
      }));
      setItems((prev) => [...prev, ...newItems]);
    }

    closeCopyModal();
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!headerData["POC No"]) return alert("Please select POC No");
    if (!headerData["Drawing Number"]) return alert("Please select Drawing Number");
    setLoading(true);
    try {
      const docData = {
        pocNo: headerData["POC No"],
        poNo: headerData["POC No"],
        equipment: headerData["Equipment"],
        weightFOrderEntered: parseNum(weightFOrderEntered),
        weightFOrderCalculated,
        weightFOrderDifference: parseNum(weightFOrderEntered) - weightFOrderCalculated,
        partName: headerData["Part Name"],
        drawingNumber: headerData["Drawing Number"],
        items: items.map((i) => ({
          pos: i.pos,
          quantity: parseNum(i.quantity),
          section: i.section,
          size: i.isPlate ? parseNum(i.size) : (i.size || "").toString().trim(),
          length: parseNum(i.length),
          width: parseNum(i.width),
          sectionalWeight: parseNum(i.sectionalWeight),
          unitWeight: typeof i.unitWeight === "number" ? i.unitWeight : parseNum(i.unitWeight),
          singleWeight: parseNum(i.singleWeight),
          drgWeight: parseNum(i.drgWeight),
          totalWeight: typeof i.totalWeight === "number" ? i.totalWeight : parseNum(i.totalWeight),
          isPlate: i.isPlate,
        })),
        totalWeight: weightFOrderCalculated,
        createdAt: new Date(),
      };
      await addDoc(collection(db, "entries"), docData);

      for (const item of items) {
        if (item.section && item.size) {
          await saveSectionSizeRelation(item.section, item.size);
        }
        if (item.section && item.size && item.length) {
          await saveSectionSizeLengthRelation(item.section, item.size, item.length);
        }
        if (item.section && item.size && item.width) {
          await saveSectionSizeWidthRelation(item.section, item.size, item.width);
        }
        // ── UPDATED: pass size so sectional weight is keyed by section+size ──
        if (item.section && item.sectionalWeight) {
          await saveSectionalWeight(item.section, item.size, item.sectionalWeight);
        }
      }

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

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="entry-container">
      <h1 className="entry-heading">SIEC-BOQ Entry</h1>

      <div className="form-wrapper">
        <h3>Project Details</h3>
        <div className="entry-grid">
          {renderAutocomplete("POC No", headerData["POC No"], (e) => handleHeaderChange("POC No", e.target.value), allPOCNos, "poNos", setAllPOCNos, "POC No")}
          {renderAutocomplete("Equipment", headerData["Equipment"], (e) => handleHeaderChange("Equipment", e.target.value), allEquipments, "equipments", setAllEquipments, "Equipment")}
          <div className="entry-input">
            <label>Weight f. Order (KG) - Entered</label>
            <input type="number" step="0.001" value={weightFOrderEntered} onChange={(e) => setWeightFOrderEntered(e.target.value)} />
          </div>
          {renderAutocomplete("Part Name", headerData["Part Name"], (e) => handleHeaderChange("Part Name", e.target.value), allPartNames, "partNames", setAllPartNames, "Part Name")}
          {renderAutocomplete("Drawing Number", headerData["Drawing Number"], (e) => handleHeaderChange("Drawing Number", e.target.value), allDrawingNumbers, "drawingNumbers", setAllDrawingNumbers, "Drawing Number")}
        </div>

        <hr />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "15px" }}>
          <h3 style={{ margin: 0 }}>Parts / Items</h3>
          <button
            type="button"
            className="btn-copy-entry"
            onClick={openCopyModal}
          >
            <HiDocumentDuplicate style={{ fontSize: "16px" }} /> Copy from Entry
          </button>
        </div>

        {items.map((item, index) => {
          const availableSizes   = getAvailableSizes(item.section);
          const availableLengths = getAvailableLengths(item.section, item.size);
          const availableWidths  = getAvailableWidths(item.section, item.size);

          return (
            <div key={item.id} className="section-card">
              {items.length > 1 && (
                <button className="remove-row-btn" onClick={() => removeRow(item.id)} type="button">
                  <HiTrash /> Remove
                </button>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "8px" }}>
                <h4 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                  Row #{index + 1} — POS:
                  <input
                    type="number"
                    value={item.pos}
                    onChange={(e) => handlePosChange(item.id, e.target.value)}
                    style={{ width: "70px", padding: "3px 6px", fontSize: "14px", fontWeight: 600, border: "1px solid #ccc", borderRadius: "4px", textAlign: "center" }}
                  />
                </h4>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#555" }}>Type:</span>
                  <button type="button"
                    onClick={() => handleItemChange(item.id, "isPlate", true)}
                    style={{ padding: "3px 12px", fontSize: "12px", borderRadius: "4px", cursor: "pointer", background: item.isPlate ? "#2980b9" : "#eee", color: item.isPlate ? "#fff" : "#333", border: "1px solid " + (item.isPlate ? "#2980b9" : "#ccc"), fontWeight: item.isPlate ? 700 : 400 }}>
                    Plate
                  </button>
                  <button type="button"
                    onClick={() => handleItemChange(item.id, "isPlate", false)}
                    style={{ padding: "3px 12px", fontSize: "12px", borderRadius: "4px", cursor: "pointer", background: !item.isPlate ? "#27ae60" : "#eee", color: !item.isPlate ? "#fff" : "#333", border: "1px solid " + (!item.isPlate ? "#27ae60" : "#ccc"), fontWeight: !item.isPlate ? 700 : 400 }}>
                    Section
                  </button>
                </div>
              </div>

              <div className="section-grid">
                <div className="entry-input">
                  <label>Quantity</label>
                  <input type="number" value={item.quantity} onChange={(e) => handleItemChange(item.id, "quantity", e.target.value)} />
                </div>

                {renderAutocomplete(
                  "Section",
                  item.section,
                  (e) => handleItemChange(item.id, "section", e.target.value),
                  allSections,
                  "sections",
                  setAllSections
                )}

                {renderRowDropdown(item, "size", "Size (mm)", availableSizes, "thicknesses", setAllSizes)}
                {renderRowDropdown(item, "length", "Length (mm)", availableLengths, "lengths", setAllLengths)}
                {renderRowDropdown(item, "width", "Width (mm)", availableWidths, "widths", setAllWidths)}

                <div className="entry-input">
                  <label>Sectional Weight (kg/m)</label>
                  <input
                    type="number" step="0.001"
                    value={item.sectionalWeight}
                    onChange={(e) => handleItemChange(item.id, "sectionalWeight", e.target.value)}
                    onBlur={() => {
                      // ── UPDATED: pass size so the record is keyed by section+size ──
                      if (item.section?.trim() && item.sectionalWeight) {
                        saveSectionalWeight(item.section, item.size, item.sectionalWeight);
                      }
                    }}
                  />
                </div>

                <div className="entry-input">
                  <label>Single Weight (kg)</label>
                  <input type="number" step="0.001" value={item.singleWeight} onChange={(e) => handleItemChange(item.id, "singleWeight", e.target.value)} />
                </div>

                <div className="entry-input">
                  <label>DRG Weight (kg)</label>
                  <input type="number" step="0.001" value={item.drgWeight}
                    onChange={(e) => handleItemChange(item.id, "drgWeight", e.target.value)}
                  />
                </div>

                <div className="entry-input">
                  <label>Calc Single Weight (kg)</label>
                  <input
                    type="number" step="0.001"
                    value={item.unitWeight}
                    onChange={(e) => handleItemChange(item.id, "unitWeight", e.target.value)}
                  />
                </div>

                <div className="entry-input">
                  <label>Calculated Weight (kg)</label>
                  <input
                    type="number" step="0.001"
                    value={item.totalWeight}
                    onChange={(e) => handleItemChange(item.id, "totalWeight", e.target.value)}
                  />
                </div>
              </div>
            </div>
          );
        })}

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
              <p>POC No: {headerData["POC No"] || "—"}</p>
            </div>
          </div>
        </div>

        <button className="entry-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Saving..." : "Save Entry"}
        </button>
      </div>

      {/* ─── Copy from Entry Modal ─────────────────────────────────────────── */}
      {copyModal.open && (
        <div className="copy-modal-overlay" onClick={closeCopyModal}>
          <div className="copy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="copy-modal-header">
              <h3>Copy Parts / Items from Another Entry</h3>
              <button className="copy-modal-close" onClick={closeCopyModal}>✕</button>
            </div>

            <div className="copy-modal-filters">
              <div className="entry-input">
                <label>Filter by POC No</label>
                <select
                  className="dropdown-select"
                  value={copyModal.pocFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCopyModal((m) => ({ ...m, pocFilter: val, selected: null }));
                    fetchEntriesForCopy(val, copyModal.equipmentFilter);
                  }}
                >
                  <option value="">All POC Nos</option>
                  {allPOCNos.map((o) => (
                    <option key={o.id} value={o.value}>{o.value}</option>
                  ))}
                </select>
              </div>
              <div className="entry-input">
                <label>Filter by Equipment</label>
                <select
                  className="dropdown-select"
                  value={copyModal.equipmentFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCopyModal((m) => ({ ...m, equipmentFilter: val, selected: null }));
                    fetchEntriesForCopy(copyModal.pocFilter, val);
                  }}
                >
                  <option value="">All Equipment</option>
                  {allEquipments.map((o) => (
                    <option key={o.id} value={o.value}>{o.value}</option>
                  ))}
                </select>
              </div>
            </div>

            {copyModal.loading && <p className="copy-modal-info">Loading…</p>}

            {!copyModal.loading && copyModal.entries.length === 0 && (
              <p className="copy-modal-info copy-modal-empty">No entries found for the selected filters.</p>
            )}

            {copyModal.entries.length > 0 && (
              <div className="copy-modal-list">
                {copyModal.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={"copy-entry-card" + (copyModal.selected?.id === entry.id ? " copy-entry-card--selected" : "")}
                    onClick={() => setCopyModal((m) => ({ ...m, selected: entry }))}
                  >
                    <div className="copy-entry-card-header">
                      <span className="copy-entry-tag">POC: {entry.pocNo || entry.poNo || "—"}</span>
                      <span className="copy-entry-tag">Equipment: {entry.equipment || "—"}</span>
                      <span className="copy-entry-tag">Drawing: {entry.drawingNumber || "—"}</span>
                      <span className="copy-entry-tag">Part: {entry.partName || "—"}</span>
                      <span className="copy-entry-tag copy-entry-rows">{(entry.items || []).length} row(s)</span>
                    </div>
                    {copyModal.selected?.id === entry.id && entry.items && entry.items.length > 0 && (
                      <table className="copy-preview-table">
                        <thead>
                          <tr>
                            <th>POS</th><th>Qty</th><th>Section</th><th>Size</th>
                            <th>Length</th><th>Width</th><th>Total Wt (kg)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.items.map((it, i) => (
                            <tr key={i}>
                              <td>{it.pos}</td>
                              <td>{it.quantity}</td>
                              <td>{it.section || "—"}</td>
                              <td>{it.size || "—"}</td>
                              <td>{it.length || "—"}</td>
                              <td>{it.width || "—"}</td>
                              <td>{it.totalWeight !== undefined ? Number(it.totalWeight).toFixed(3) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}

            {copyModal.selected && (
              <div className="copy-modal-footer">
                <div className="copy-what-label">Copying: <strong>Parts / Items ({(copyModal.selected.items || []).length} rows)</strong></div>
                <div className="copy-modal-actions">
                  <button className="btn-copy-cancel" onClick={closeCopyModal} type="button">Cancel</button>
                  <button className="btn-copy-apply" onClick={applyCopy} type="button">
                    <HiDocumentDuplicate /> Copy Items
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

