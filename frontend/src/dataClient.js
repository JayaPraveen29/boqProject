// Drop-in replacement for firebase.js + firebase/firestore.
// It mimics the small subset of the Firestore API this app uses
// (collection, doc, addDoc, getDocs, updateDoc, deleteDoc, getDoc, query, orderBy)
// but talks to our own Express + MySQL backend instead.
//
// Usage in your page files: change
//   import { db } from "../../firebase";
//   import { collection, addDoc, getDocs, ... } from "firebase/firestore";
// to
//   import { db } from "../../dataClient";
//   import { collection, addDoc, getDocs, ... } from "../../dataClient";
// Nothing else in your components needs to change.

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// ngrok's free tier shows a browser warning interstitial that blocks requests
// unless this header is sent. Harmless if you switch away from ngrok later.
const NGROK_HEADER = { "ngrok-skip-browser-warning": "true" };

export const db = {}; // placeholder, kept only so `db` still "exists" like before

export function collection(_db, name) {
  return { type: "collection", name };
}

export function doc(_db, name, id) {
  return { type: "doc", name, id };
}

export function orderBy(field, direction = "asc") {
  return { field, direction };
}

export function query(collRef, orderByDescriptor) {
  return { ...collRef, type: "query", orderByDescriptor };
}

function makeDocSnap(row) {
  return {
    id: row.id,
    data: () => {
      const { id, ...rest } = row;
      return rest;
    },
  };
}

export async function getDocs(refOrQuery) {
  const res = await fetch(`${BASE_URL}/api/${refOrQuery.name}`, { headers: NGROK_HEADER });
  if (!res.ok) throw new Error(`Failed to fetch ${refOrQuery.name}`);
  let rows = await res.json();

  if (refOrQuery.orderByDescriptor) {
    const { field, direction } = refOrQuery.orderByDescriptor;
    rows = [...rows].sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (av < bv) return direction === "desc" ? 1 : -1;
      if (av > bv) return direction === "desc" ? -1 : 1;
      return 0;
    });
  }

  return {
    docs: rows.map(makeDocSnap),
  };
}

export async function getDoc(docRef) {
  const res = await fetch(`${BASE_URL}/api/${docRef.name}/${docRef.id}`, { headers: NGROK_HEADER });
  if (!res.ok) throw new Error(`Failed to fetch ${docRef.name}/${docRef.id}`);
  const row = await res.json();
  if (!row) {
    return { exists: () => false, data: () => undefined, id: docRef.id };
  }
  return {
    exists: () => true,
    data: () => {
      const { id, ...rest } = row;
      return rest;
    },
    id: row.id,
  };
}

export async function addDoc(collRef, data) {
  const res = await fetch(`${BASE_URL}/api/${collRef.name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...NGROK_HEADER },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to add doc to ${collRef.name}`);
  const result = await res.json();
  return { id: result.id };
}

export async function updateDoc(docRef, data) {
  const res = await fetch(`${BASE_URL}/api/${docRef.name}/${docRef.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...NGROK_HEADER },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update ${docRef.name}/${docRef.id}`);
  return res.json();
}

export async function deleteDoc(docRef) {
  const res = await fetch(`${BASE_URL}/api/${docRef.name}/${docRef.id}`, {
    method: "DELETE",
    headers: NGROK_HEADER,
  });
  if (!res.ok) throw new Error(`Failed to delete ${docRef.name}/${docRef.id}`);
  return res.json();
}