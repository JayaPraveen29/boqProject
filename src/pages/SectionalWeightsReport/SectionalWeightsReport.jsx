import { useState, useEffect, useMemo } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import "./SectionalWeightsReport.css";

export default function SectionalWeightsReport() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "entries"));
      const map = new Map(); // dedupe by section|size|length|sectionalWeight

      snap.docs.forEach((d) => {
        const data = d.data();
        if (!Array.isArray(data.items)) return;
        data.items.forEach((item) => {
          const section = (item.section ?? "").toString().trim();
          const size = item.size ?? "";
          const length = item.length ?? "";
          const sectionalWeight = item.sectionalWeight ?? "";

          // Only include rows that actually have a section and a sectional weight
          if (!section || sectionalWeight === "" || sectionalWeight === undefined || sectionalWeight === null) return;

          const key = `${section}|${size}|${length}|${sectionalWeight}`;
          if (!map.has(key)) {
            map.set(key, { section, size, length, sectionalWeight });
          }
        });
      });

      const unique = Array.from(map.values()).sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section, undefined, { numeric: true });
        if (a.size !== b.size) return String(a.size).localeCompare(String(b.size), undefined, { numeric: true });
        return String(a.length).localeCompare(String(b.length), undefined, { numeric: true });
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
      [r.section, r.size, r.length, r.sectionalWeight]
        .some((v) => v.toString().toLowerCase().includes(q))
    );
  }, [rows, searchQuery]);

  const formatNum = (v) => {
    const n = parseFloat(v);
    if (isNaN(n)) return v ?? "—";
    return n.toFixed(3);
  };

  return (
    <div className="swr-container">
      <h1 className="swr-heading">Sectional Weights Report</h1>
      <p className="swr-subtitle">
        Section, Size, Length, and Sectional Weight (kg/m) values already used on the Entry Page.
      </p>

      <div className="swr-toolbar">
        <div className="swr-search-wrapper">
          <span className="swr-search-icon">🔍</span>
          <input
            type="text"
            className="swr-search"
            placeholder="Search Section, Size, Length, Sectional Weight..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="swr-search-clear" onClick={() => setSearchQuery("")}>✕</button>
          )}
        </div>
        <button className="swr-refresh-btn" onClick={fetchData} disabled={loading}>
          {loading ? "Loading..." : "⟳ Refresh"}
        </button>
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
                <th className="swr-th">Length (mm)</th>
                <th className="swr-th">Sectional Weight (kg/m)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={idx} className="swr-row">
                  <td className="swr-td swr-td--no">{idx + 1}</td>
                  <td className="swr-td">{row.section || "—"}</td>
                  <td className="swr-td">{row.size !== "" ? row.size : "—"}</td>
                  <td className="swr-td">{row.length !== "" ? row.length : "—"}</td>
                  <td className="swr-td swr-td--numeric">{formatNum(row.sectionalWeight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <div className="swr-footer">
          {searchQuery
            ? `Showing ${filtered.length} of ${rows.length} unique combinations`
            : `${rows.length} unique combinations total`}
        </div>
      )}
    </div>
  );
}