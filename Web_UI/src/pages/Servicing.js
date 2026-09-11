import React, { useEffect, useMemo, useState, useRef } from "react";
import { Card, Row, Col, Button, Form, Alert, ProgressBar, Badge, Spinner } from "@themesberg/react-bootstrap";

function safeRole(x) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}

function safeJsonParse(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function readCorrectionContextFromHash() {
  try {
    const hash = String(window.location.hash || "");
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    const correctionOf = String(params.get("correctionOf") || "").trim();
    if (!correctionOf) return null;
    return {
      correctionOf,
      reason: String(params.get("reason") || "").trim()
    };
  } catch {
    return null;
  }
}

function normalizeServiceToFreqKey(serviceLabel) {
  const s = String(serviceLabel || "").trim().toLowerCase();
  if (s === "weekly") return "weekly";
  if (s === "monthly") return "monthly";
  if (s === "3-monthly" || s === "3monthly" || s === "quarterly") return "quarterly";
  if (s === "annual" || s === "yearly") return "annual";
  return "monthly";
}

function mergeQuestions(checklist, frequencyKey, standards) {
  const freqOrder = ["weekly", "monthly", "quarterly", "annual"];
  const idx = Math.max(0, freqOrder.indexOf(frequencyKey));
  const selectedFreqs = freqOrder.slice(0, idx + 1);

  const out = {};
  (standards || []).forEach((std) => {
    out[std] = [];
    selectedFreqs.forEach((fk) => {
      const chunk = checklist?.[fk]?.[std];
      if (Array.isArray(chunk)) out[std].push(...chunk);
    });
  });

  const general = checklist?.general?.general;
  out.General = Array.isArray(general) ? general : [];
  return out;
}

function getChecklistPayload(data) {
  return data?.checklist && typeof data.checklist === "object" ? data.checklist : data;
}

function getAvailableStandards(checklist) {
  const set = new Set();
  if (!checklist || typeof checklist !== "object") return [];
  Object.keys(checklist).forEach((freq) => {
    if (freq === "general") return;
    const group = checklist[freq];
    if (!group || typeof group !== "object" || Array.isArray(group)) return;
    Object.keys(group).forEach((std) => {
      if (Array.isArray(group[std])) set.add(std);
    });
  });
  return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
}

function defaultStandardsForChecklist(checklist) {
  return getAvailableStandards(checklist);
}

function standardsFromDraftValue(v) {
  if (Array.isArray(v?.selectedStandards)) return v.selectedStandards.filter(Boolean);

  // Backward compatibility for older drafts saved before dynamic standards.
  const out = [];
  if (v?.nfpa72) out.push("NFPA 72");
  if (v?.nfpa2001) out.push("NFPA 2001");
  return out;
}

function makeQid(std, qText, idx) {
  const base = `${std}__${idx}__${String(qText || "").slice(0, 40)}`;
  return base.replace(/[^a-zA-Z0-9_]+/g, "_");
}

// ---- Photo helpers ----
function isGeneralStd(std) {
  return String(std || "").trim().toLowerCase() === "general";
}

function needsPhotoForAnswer(std, answer) {
  const a = String(answer || "").toUpperCase();
  // Normal questions: photo required when FAIL
  if (!isGeneralStd(std)) return a === "FAIL";
  // General questions: photo required when YES
  return a === "YES";
}

function answerOptionsForStd(std) {
  return isGeneralStd(std)
    ? [
        { v: "", l: "Select answer…" },
        { v: "YES", l: "YES" },
        { v: "NO", l: "NO" },
        { v: "N/A", l: "N/A" }
      ]
    : [
        { v: "", l: "Select answer…" },
        { v: "PASS", l: "PASS" },
        { v: "FAIL", l: "FAIL" },
        { v: "N/A", l: "N/A" }
      ];
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "").toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(ua);
}

// ---- Signature helpers (no external libs) ----
function getCanvasPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches && e.touches[0] ? e.touches[0] : e;
  return {
    x: src.clientX - rect.left,
    y: src.clientY - rect.top
  };
}

function resizeCanvasToCSS(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const targetW = Math.round(cssWidth * dpr);
  const targetH = Math.round(cssHeight * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

// ---- IndexedDB helpers (offline cache + queue) ----
function openMaintenixDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("maintenix");
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("servicingCache")) {
        db.createObjectStore("servicingCache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("servicingJobs")) {
        const s = db.createObjectStore("servicingJobs", { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).put(value);
  });
}

async function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).delete(key);
  });
}

function blobFromDataUrl(dataUrl) {
  try {
    const parts = String(dataUrl || "").split(",");
    if (parts.length < 2) return null;
    const meta = parts[0];
    const b64 = parts[1];
    const mimeMatch = /data:(.*?);base64/.exec(meta);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch {
    return null;
  }
}

const CLIENT_MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const CLIENT_TARGET_PHOTO_BYTES = 3 * 1024 * 1024;
const CLIENT_MAX_PHOTO_DIMENSION = 1600;
const CLIENT_JPEG_QUALITY = 0.78;

function bytesToMb(bytes) {
  return (Number(bytes || 0) / 1024 / 1024).toFixed(1);
}

function compressImageFile(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || "").startsWith("image/")) return resolve(file);
    if (file.size && file.size <= CLIENT_TARGET_PHOTO_BYTES) return resolve(file);

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, CLIENT_MAX_PHOTO_DIMENSION / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return resolve(file);
          const name = String(file.name || "photo.jpg").replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", CLIENT_JPEG_QUALITY);
      } catch {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function makeJobId() {
  return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeReportId() {
  return `svc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ Draft helpers
function makeDraftKey() {
  return `servicing_draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function formatDateTimeLocal(iso) {
  try {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso || "");
  }
}

function safeNamePart(v, fallback) {
  const s = String(v || "").trim();
  if (!s) return fallback;
  return s
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 60);
}

function last4FromSource(source) {
  const s = String(source || "").trim();
  const digits = (s.match(/\d+/g) || []).join("");
  return digits ? digits.slice(-4).padStart(4, "0") : "0000";
}

function buildServerStyleBaseName(areaValue, serviceValue, createdAt, uniqueSource) {
  const dateCreated = String(createdAt || new Date().toISOString()).slice(0, 10);
  const last4 = last4FromSource(uniqueSource || Date.now());
  return `${safeNamePart(areaValue, "area")}_${safeNamePart(serviceValue, "service")}_${dateCreated}_${last4}`;
}

// Runner lock to avoid double-processing if multiple tabs open
function getRunnerLockKey() {
  return "maintenix_servicing_runner_lock";
}
function nowMs() {
  return Date.now();
}
function acquireRunnerLock(ttlMs = 8000) {
  try {
    const key = getRunnerLockKey();
    const raw = localStorage.getItem(key) || "";
    const cur = raw ? safeJsonParse(raw, null) : null;
    if (cur?.expiresAt && cur.expiresAt > nowMs()) return false;

    const next = { expiresAt: nowMs() + ttlMs };
    localStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return true; // if localStorage blocked, just run (best-effort)
  }
}
function releaseRunnerLock() {
  try {
    localStorage.removeItem(getRunnerLockKey());
  } catch {}
}

export default function Servicing() {
  const authUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);
  const authToken = localStorage.getItem("authToken") || "";
  const roleKey = safeRole(authUser?.role);
  const topRef = useRef(null);
  const correctionContext = useMemo(() => readCorrectionContextFromHash(), []);

  const canAccess = ["ADMIN", "L1", "L2", "L3"].includes(roleKey);

  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [highlightMissingPhotos, setHighlightMissingPhotos] = useState(false);

  // Photo input refs per question (to trigger camera/file picker)
  const photoInputRefs = useRef({});

  // Steps: 0=PreStart, 1=Questionnaire, 2=Review, 3=Final
  const [step, setStep] = useState(0);

  // Prestart
  const [area, setArea] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [areaOpen, setAreaOpen] = useState(false); // ✅ dropdown open state
  const areaBoxRef = useRef(null); // ✅ outside click detection
  const areaInputRef = useRef(null); // ✅ focus/select behavior
  const areaCloseTimerRef = useRef(null); // ✅ blur delay to allow click
  const [serviceType, setServiceType] = useState("");
  const [systemType, setSystemType] = useState("substation");
  const [selectedStandardsState, setSelectedStandardsState] = useState([]);
  // Legacy draft booleans are still read by standardsFromDraftValue().

  // Loaded lists
  const [areaOptions, setAreaOptions] = useState([]);
  const [serviceOptions, setServiceOptions] = useState([]);

  // Checklist
  const [checklist, setChecklist] = useState(null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // ✅ Offline/queue UI
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [dbReady, setDbReady] = useState(false);
  const dbRef = useRef(null);

  const [jobs, setJobs] = useState([]); // local UI snapshot
  const [loadingJobs, setLoadingJobs] = useState(false);

  // ✅ Drafts UI
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  // ✅ Signature state
  const sigCanvasRef = useRef(null);
  const sigCtxRef = useRef(null);
  const sigIsDrawingRef = useRef(false);
  const sigLastRef = useRef({ x: 0, y: 0 });

  const [signatureDataUrl, setSignatureDataUrl] = useState(""); // base64 png
  const [signatureTouched, setSignatureTouched] = useState(false);

  useEffect(() => {
    let mounted = true;

    openMaintenixDb()
      .then((db) => {
        if (!mounted) return;
        dbRef.current = db;
        setDbReady(true);
      })
      .catch(() => {
        setDbReady(false);
      });

    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);

    const onJobEvent = () => {
      refreshJobs();
    };
    window.addEventListener("maintenix:servicing-jobs", onJobEvent);

    return () => {
      mounted = false;
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
      window.removeEventListener("maintenix:servicing-jobs", onJobEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ close Area dropdown when clicking outside
  useEffect(() => {
    const onDocDown = (e) => {
      if (!areaOpen) return;
      const box = areaBoxRef.current;
      if (!box) return;
      if (box.contains(e.target)) return;
      setAreaOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [areaOpen]);

  const filteredAreaOptions = useMemo(() => {
    const q = String(areaSearch || "").trim().toLowerCase();
    if (!q) return areaOptions;

    const filtered = (areaOptions || []).filter((a) => String(a || "").toLowerCase().includes(q));

    // If the user already selected an area, keep it visible even if it doesn't match the filter
    if (area && !filtered.includes(area) && (areaOptions || []).includes(area)) {
      return [area, ...filtered];
    }

    return filtered;
  }, [areaOptions, areaSearch, area]);

  const availableStandards = useMemo(() => getAvailableStandards(checklist), [checklist]);

  const selectedStandards = useMemo(() => {
    const allowed = new Set(availableStandards);
    return (selectedStandardsState || []).filter((std) => allowed.has(std));
  }, [selectedStandardsState, availableStandards]);

  const frequencyKey = useMemo(() => normalizeServiceToFreqKey(serviceType), [serviceType]);

  const merged = useMemo(() => {
    if (!checklist) return null;
    if (!selectedStandards.length) return null;
    return mergeQuestions(checklist, frequencyKey, selectedStandards);
  }, [checklist, frequencyKey, selectedStandards]);

  useEffect(() => {
    if (!checklist) return;
    setSelectedStandardsState((prev) => {
      const allowed = getAvailableStandards(checklist);
      const kept = (prev || []).filter((std) => allowed.includes(std));
      return kept.length ? kept : defaultStandardsForChecklist(checklist);
    });
  }, [checklist]);

  const questionRows = useMemo(() => {
    if (!merged) return [];
    const rows = [];
    Object.keys(merged).forEach((std) => {
      const list = merged[std] || [];
      list.forEach((q, idx) => {
        const qText = String(q?.question || "").trim();
        if (!qText) return;
        rows.push({
          id: makeQid(std, qText, idx),
          std,
          question: qText,
          extra: q?.extra ?? ""
        });
      });
    });
    return rows;
  }, [merged]);

  const [answers, setAnswers] = useState({});

  const unansweredCount = useMemo(() => {
    if (!questionRows.length) return 0;
    return questionRows.filter((q) => !answers?.[q.id]?.answer).length;
  }, [questionRows, answers]);

  const photoMissingCount = useMemo(() => {
    if (!questionRows.length) return 0;
    return questionRows.filter((q) => {
      const a = answers?.[q.id] || {};
      const need = needsPhotoForAnswer(q.std, a.answer);
      return need && !a.photoFile && !a.photoDataUrl;
    }).length;
  }, [questionRows, answers]);

  const progress = useMemo(() => Math.round(((step + 1) / 4) * 100), [step]);

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  async function cacheSet(key, value) {
    if (!dbRef.current) return;
    await idbPut(dbRef.current, "servicingCache", { key, value, updatedAt: new Date().toISOString() });
  }

  async function cacheGet(key) {
    if (!dbRef.current) return null;
    const rec = await idbGet(dbRef.current, "servicingCache", key);
    return rec?.value ?? null;
  }

  async function apiJson(path, options = {}) {
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken}`
    };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.message || `Request failed (HTTP ${res.status})`);
    }
    return data;
  }

  async function listServerDrafts() {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    const data = await apiJson("/api/servicing/drafts");
    return Array.isArray(data?.drafts) ? data.drafts : [];
  }

  async function saveServerDraft(rec) {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    const data = await apiJson("/api/servicing/drafts", {
      method: "POST",
      body: JSON.stringify(rec)
    });
    return data?.draft || rec;
  }

  async function getServerDraft(key) {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    const data = await apiJson(`/api/servicing/drafts/${encodeURIComponent(key)}`);
    return data?.draft || null;
  }

  async function deleteServerDraft(key) {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    await apiJson(`/api/servicing/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  async function getDraftRecord(key) {
    if (authToken && navigator.onLine) {
      try {
        const serverRec = await getServerDraft(key);
        if (serverRec) return serverRec;
      } catch {
        // fall back to local mirror
      }
    }
    if (!dbRef.current) return null;
    return await idbGet(dbRef.current, "servicingCache", key);
  }

  async function refreshJobs() {
    if (!dbRef.current) return;
    setLoadingJobs(true);
    try {
      const all = await idbGetAll(dbRef.current, "servicingJobs");
      const sorted = (all || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      setJobs(sorted);
    } catch {
      // ignore
    } finally {
      setLoadingJobs(false);
    }
  }

  // ✅ Drafts refresh
  async function refreshDrafts() {
    if (!dbRef.current) return;
    setLoadingDrafts(true);
    try {
      const all = await idbGetAll(dbRef.current, "servicingCache");
      const onlyDrafts = (all || [])
        .filter((x) => x && typeof x.key === "string" && x.key.startsWith("servicing_draft_"))
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

      if (authToken && navigator.onLine) {
        try {
          const serverDrafts = await listServerDrafts();
          const byKey = new Map();
          serverDrafts.forEach((d) => byKey.set(d.key, d));
          onlyDrafts.forEach((d) => {
            if (!byKey.has(d.key)) byKey.set(d.key, d);
          });
          setDrafts(Array.from(byKey.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
          return;
        } catch {
          // use local fallback below
        }
      }

      setDrafts(onlyDrafts);
    } catch {
      // ignore
    } finally {
      setLoadingDrafts(false);
    }
  }

  function emitJobsEvent() {
    try {
      window.dispatchEvent(new Event("maintenix:servicing-jobs"));
    } catch {}
  }

  async function loadListsAndChecklist() {
    setErr("");
    setInfo("");
    if (!authToken) {
      setErr("Not logged in.");
      return;
    }

    setLoadingLists(true);
    setLoadingChecklist(true);

    try {
      // Network first
      const [areasRes, servicesRes, checklistRes] = await Promise.allSettled([
        fetchJson("/api/servicing/areas"),
        fetchJson("/api/servicing/services"),
        fetchJson(`/api/servicing/checklist?type=${encodeURIComponent(systemType)}`)
      ]);

      if (areasRes.status === "fulfilled") {
        const a = Array.isArray(areasRes.value?.areas) ? areasRes.value.areas : [];
        setAreaOptions(a);
        await cacheSet("areas", a);
      } else {
        // Offline / API fail: fallback to cache
        const cached = await cacheGet("areas");
        if (Array.isArray(cached) && cached.length) {
          setAreaOptions(cached);
          setInfo("Offline: loaded cached areas.");
        } else {
          setAreaOptions(["Pump Room", "Server Room", "Warehouse", "Office"]);
          setInfo("Areas endpoint not available yet — using defaults for now.");
        }
      }

      if (servicesRes.status === "fulfilled") {
        const s = Array.isArray(servicesRes.value?.services) ? servicesRes.value.services : [];
        setServiceOptions(s);
        await cacheSet("services", s);
      } else {
        const cached = await cacheGet("services");
        if (Array.isArray(cached) && cached.length) {
          setServiceOptions(cached);
          setInfo((prev) => (prev ? prev : "Offline: loaded cached services."));
        } else {
          setServiceOptions(["Weekly", "Monthly", "3-Monthly", "Annual"]);
          setInfo((prev) => (prev ? prev : "Services endpoint not available yet — using defaults for now."));
        }
      }

      if (checklistRes.status === "fulfilled") {
        const loadedChecklist = getChecklistPayload(checklistRes.value);
        setChecklist(loadedChecklist);
        await cacheSet(`checklist_${systemType}`, loadedChecklist);
      } else {
        const cached = await cacheGet(`checklist_${systemType}`) || await cacheGet("checklist");
        if (cached) {
          setChecklist(cached);
          setInfo((prev) => (prev ? prev : "Offline: loaded cached checklist."));
        } else {
          setChecklist(null);
          setInfo((prev) => (prev ? prev : "Checklist endpoint not available yet."));
        }
      }
    } catch (e) {
      setErr(String(e?.message || "Failed to load servicing data."));
    } finally {
      setLoadingLists(false);
      setLoadingChecklist(false);
    }
  }

  useEffect(() => {
    // Online can fetch immediately; offline must wait for IndexedDB so cached checklists can load.
    const isOnlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
    if (canAccess && (isOnlineNow || dbReady)) loadListsAndChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemType, dbReady, canAccess]);

  useEffect(() => {
    if (dbReady) refreshJobs();
    if (dbReady) refreshDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady]);

  useEffect(() => {
    setErr("");
    setHighlightMissing(false);
    setHighlightMissingPhotos(false);
  }, [step]);

  function validatePreStart() {
    if (!area) return "Please select an Area.";
    if (!serviceType) return "Please select a Service Type.";
    if (!selectedStandards.length) return "Please select at least one standard.";
    if (!checklist) return "Checklist is not loaded yet.";
    return "";
  }

  function primeAnswers() {
    setAnswers((prev) => {
      const next = { ...(prev || {}) };
      questionRows.forEach((q) => {
        if (!next[q.id]) next[q.id] = { answer: "", comment: "", extra: {}, photoDataUrl: "", photoFile: null };
      });
      return next;
    });
  }

  function updateAnswer(qid, patch) {
    setAnswers((prev) => {
      const current = prev?.[qid] || { answer: "", comment: "", extra: {}, photoDataUrl: "", photoFile: null };
      return { ...prev, [qid]: { ...current, ...patch } };
    });
  }

  // ---- Photos (per question) ----
  const isMobile = useMemo(() => isMobileDevice(), []);

  const onPhotoSelected = async (qid, file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setErr("Please select an image file.");
      return;
    }
    if (file.size > CLIENT_MAX_PHOTO_BYTES) {
      setErr(`Photo is too large (${bytesToMb(file.size)}MB). Please choose a smaller image.`);
      return;
    }

    const prepared = await compressImageFile(file);
    if (prepared?.size > CLIENT_MAX_PHOTO_BYTES) {
      setErr(`Photo is still too large after compression (${bytesToMb(prepared.size)}MB). Please choose a smaller image.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateAnswer(qid, { photoDataUrl: String(reader.result || ""), photoFile: prepared });
    };
    reader.onerror = () => setErr("Failed to read selected photo.");
    reader.readAsDataURL(prepared);
  };

  const clearPhoto = (qid) => {
    updateAnswer(qid, { photoDataUrl: "", photoFile: null });
    const el = photoInputRefs.current?.[qid];
    if (el) {
      try {
        el.value = "";
      } catch {}
    }
  };

  const triggerPhotoPicker = (qid) => {
    const el = photoInputRefs.current?.[qid];
    if (el && typeof el.click === "function") el.click();
  };

  // ---- Signature: init + redraw ----
  function initSignatureCanvasIfNeeded() {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    sigCtxRef.current = ctx;
    resizeCanvasToCSS(canvas, ctx);

    // white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // stroke
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }

  useEffect(() => {
    if (step !== 2) return;

    const t = window.setTimeout(() => {
      initSignatureCanvasIfNeeded();

      // redraw saved signature if exists
      if (signatureDataUrl && sigCanvasRef.current && sigCtxRef.current) {
        const img = new Image();
        img.onload = () => {
          const canvas = sigCanvasRef.current;
          const ctx = sigCtxRef.current;
          if (!canvas || !ctx) return;

          resizeCanvasToCSS(canvas, ctx);

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const dpr = window.devicePixelRatio || 1;
          const w = canvas.width / dpr;
          const h = canvas.height / dpr;
          ctx.drawImage(img, 0, 0, w, h);
        };
        img.src = signatureDataUrl;
      }
    }, 0);

    return () => {
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function beginSignature(e) {
    const canvas = sigCanvasRef.current;
    const ctx = sigCtxRef.current;
    if (!canvas || !ctx) return;

    if (e?.preventDefault) e.preventDefault();

    resizeCanvasToCSS(canvas, ctx);

    const p = getCanvasPoint(e, canvas);
    sigIsDrawingRef.current = true;
    sigLastRef.current = p;

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);

    setSignatureTouched(true);
  }

  function moveSignature(e) {
    const canvas = sigCanvasRef.current;
    const ctx = sigCtxRef.current;
    if (!canvas || !ctx) return;
    if (!sigIsDrawingRef.current) return;

    if (e?.preventDefault) e.preventDefault();

    const p = getCanvasPoint(e, canvas);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    sigLastRef.current = p;
  }

  function endSignature() {
    if (!sigIsDrawingRef.current) return;
    sigIsDrawingRef.current = false;
  }

  function clearSignature() {
    const canvas = sigCanvasRef.current;
    const ctx = sigCtxRef.current;
    if (!canvas || !ctx) return;

    resizeCanvasToCSS(canvas, ctx);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";

    setSignatureDataUrl("");
    setSignatureTouched(false);
  }

  function captureSignatureNow() {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    try {
      setSignatureDataUrl(canvas.toDataURL("image/png"));
    } catch {}
  }

  function next() {
    setErr("");
    setInfo("");

    if (step === 0) {
      const msg = validatePreStart();
      if (msg) {
        setErr(msg);
        return;
      }
      primeAnswers();
      setHighlightMissing(false);
      setStep(1);
      return;
    }

    if (step === 1) {
      if (unansweredCount > 0) {
        setErr(`Please answer all questions before continuing. Unanswered: ${unansweredCount}`);
        setHighlightMissing(true);
        setHighlightMissingPhotos(false);

        if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (photoMissingCount > 0) {
        setErr(`Please take required photos before continuing. Missing: ${photoMissingCount}`);
        setHighlightMissing(false);
        setHighlightMissingPhotos(true);

        if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setHighlightMissing(false);
      setHighlightMissingPhotos(false);
      setStep(2);
      return;
    }

    if (step === 2) {
      // Capture signature only when leaving Review
      if (signatureTouched) {
        captureSignatureNow();
      }
      setHighlightMissing(false);
      setStep(3);
      return;
    }

    setHighlightMissing(false);
    setStep((s) => Math.min(3, s + 1));
  }

  function back() {
    setErr("");
    setInfo("");
    setStep((s) => Math.max(0, s - 1));
  }

  async function downloadFile(url, fileName) {
    setErr("");
    setInfo("");

    if (!authToken) {
      setErr("Not logged in.");
      return;
    }
    if (!url) {
      setErr("No download URL returned by server.");
      return;
    }

    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.message || `Download failed (HTTP ${res.status}).`);
        return;
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName || "service_report.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(blobUrl);
    } catch {
      setErr("Download failed (API not reachable).");
    }
  }

  // ---------------------------
  // ✅ Server background job flow
  // ---------------------------
  async function submitJobToServer(job) {
    if (!authToken) throw new Error("Not logged in.");
    if (!navigator.onLine) throw new Error("Offline");

    const reportId = String(job?.reportId || job?.payload?.reportId || "").trim();
    if (!reportId) throw new Error("Missing reportId.");

    const payload = { ...(job.payload || {}), reportId };

    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));

    const attachments = Array.isArray(job.attachments) ? job.attachments : [];
    attachments.forEach((a) => {
      if (!a?.field || !a?.blob) return;
      try {
        fd.append(String(a.field), a.blob, a.fileName || `${a.field}.jpg`);
      } catch {
        // ignore
      }
    });

    const res = await fetch("/api/servicing/submit-payload", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: fd
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `Submit failed (HTTP ${res.status})`);

    return {
      reportId: data.reportId || reportId,
      serverStatus: data.status || "pending"
    };
  }

  async function pollServerStatus(reportId) {
    if (!authToken) throw new Error("Not logged in.");
    const rid = String(reportId || "").trim();
    if (!rid) throw new Error("Missing reportId.");

    const res = await fetch(`/api/servicing/status/${encodeURIComponent(rid)}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `Status failed (HTTP ${res.status})`);
    return data;
  }

  function stripPayloadOnSuccess(job) {
    // Requirement: remove payload JSON/cache after success, but keep download info + summary
    return {
      ...job,
      payload: null,
      attachments: [],
      error: "",
      lastUpdateAt: new Date().toISOString()
    };
  }

  async function processQueueOnce() {
    if (!dbRef.current) return;
    if (!navigator.onLine) return;
    if (!authToken) return;

    // Avoid multiple tabs processing at once
    if (!acquireRunnerLock(8000)) return;

    let job = null;

    try {
      const all = await idbGetAll(dbRef.current, "servicingJobs");
      const jobsAll = Array.isArray(all) ? all : [];

      // Priority: queued/submitting/server_pending
      const pick = jobsAll.find((j) =>
        ["queued", "submitting", "server_pending", "running", "polling"].includes(String(j?.status || ""))
      );

      if (!pick) return;

      job = { ...pick };

      // 1) Submit if queued
      if (job.status === "queued") {
        job.status = "submitting";
        job.lastUpdateAt = new Date().toISOString();
        await idbPut(dbRef.current, "servicingJobs", job);
        emitJobsEvent();

        const { reportId } = await submitJobToServer(job);

        job.reportId = reportId;
        if (job.payload) job.payload.reportId = reportId;

        job.status = "server_pending";
        job.lastUpdateAt = new Date().toISOString();
        await idbPut(dbRef.current, "servicingJobs", job);
        emitJobsEvent();
        return;
      }

      // 2) Poll if submitted
      if (["server_pending", "running", "polling", "submitting"].includes(job.status)) {
        const rid = job.reportId || job?.payload?.reportId;
        if (!rid) {
          job.status = "error";
          job.error = "Missing reportId (cannot poll).";
          job.lastUpdateAt = new Date().toISOString();
          await idbPut(dbRef.current, "servicingJobs", job);
          emitJobsEvent();
          return;
        }

        job.status = "polling";
        job.lastUpdateAt = new Date().toISOString();
        await idbPut(dbRef.current, "servicingJobs", job);
        emitJobsEvent();

        const st = await pollServerStatus(rid);

        const s = String(st?.status || "").toLowerCase();

        if (s === "done") {
          const result = st?.result || {};
          job.status = "done";
          job.result = {
            fileName: String(result?.fileName || ""),
            url: String(result?.url || "")
          };
          // Remove payload + attachments after success
          const cleaned = stripPayloadOnSuccess(job);
          if (cleaned.draftKey) {
            try {
              await deleteServerDraft(cleaned.draftKey);
            } catch (e) {
              console.warn("Failed to delete completed server draft.", e);
            }
            try {
              await idbDelete(dbRef.current, "servicingCache", cleaned.draftKey);
            } catch (e) {
              console.warn("Failed to delete completed browser draft.", e);
            }
            await refreshDrafts();
          }
          await idbPut(dbRef.current, "servicingJobs", cleaned);
          emitJobsEvent();
          return;
        }

        if (s === "error") {
          job.status = "error";
          job.error = String(st?.error || "Server job failed.");
          job.lastUpdateAt = new Date().toISOString();
          await idbPut(dbRef.current, "servicingJobs", job);
          emitJobsEvent();
          return;
        }

        // pending/running => keep waiting
        job.status = s === "running" ? "running" : "server_pending";
        job.lastUpdateAt = new Date().toISOString();
        await idbPut(dbRef.current, "servicingJobs", job);
        emitJobsEvent();
      }
    } catch (e) {
      if (job?.id && dbRef.current) {
        const message = String(e?.message || "Job could not be processed.");
        const isMissingServerJob = /job not found|status failed \(http 404\)|http 404/i.test(message);
        const next = {
          ...job,
          status: "error",
          error: isMissingServerJob
            ? "This saved job is no longer available on the server. Please clear it and submit the report again if needed."
            : message,
          lastUpdateAt: new Date().toISOString()
        };
        await idbPut(dbRef.current, "servicingJobs", next);
        emitJobsEvent();
      }
    } finally {
      releaseRunnerLock();
    }
  }

  // Background loop: if online, keep nudging the queue forward
  useEffect(() => {
    if (!dbReady) return;
    if (!canAccess) return;

    let alive = true;

    const tick = async () => {
      if (!alive) return;
      await processQueueOnce();
    };

    // initial kick + interval
    tick();
    const t = window.setInterval(tick, 2000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady, online, authToken, canAccess]);

  // ✅ Draft record build/load helpers
  function buildDraftValue() {
    const cleanAnswers = {};
    Object.keys(answers || {}).forEach((k) => {
      const a = answers?.[k] || {};
      cleanAnswers[k] = {
        answer: a.answer || "",
        comment: a.comment || "",
        extra: a.extra || {},
        photoDataUrl: a.photoDataUrl || "",
        photoFile: null
      };
    });

    return {
      step,
      area,
      serviceType,
      systemType,
      selectedStandards,
      nfpa72: selectedStandards.includes("NFPA 72"),
      nfpa2001: selectedStandards.includes("NFPA 2001"),
      areaSearch,
      answers: cleanAnswers,
      signatureDataUrl: signatureDataUrl || "",
      signatureTouched: false,
      questionRowsSnapshot: (questionRows || []).map((q) => ({
        id: q.id,
        std: q.std,
        question: q.question,
        extra: q.extra || ""
      }))
    };
  }

  function loadDraftValueIntoForm(value) {
    const v = value || {};
    setArea(v.area || "");
    setServiceType(v.serviceType || "");
    setSystemType(v.systemType === "conveyor" ? "conveyor" : "substation");
    const draftStandards = standardsFromDraftValue(v);
    setSelectedStandardsState(draftStandards);
    setAreaSearch(v.areaSearch || "");
    setAreaOpen(false);

    setAnswers(v.answers || {});
    setSignatureDataUrl(v.signatureDataUrl || "");
    setSignatureTouched(false);

    // safest: return user to start (they can Next through)
    setStep(0);

    setHighlightMissing(false);
    setHighlightMissingPhotos(false);
  }

  function buildDraftNameFromValue(value, uniqueSource) {
    const v = value || {};
    return buildServerStyleBaseName(v.area, v.serviceType, new Date().toISOString(), uniqueSource || Date.now());
  }

  async function saveDraftRecord(nameOverride, valueOverride) {
    if (!dbRef.current) throw new Error("Offline storage not available in this browser.");

    const key = makeDraftKey();
    const value = valueOverride || buildDraftValue();
    const name = String(nameOverride || "").trim() || buildDraftNameFromValue(value, key);

    const rec = {
      key,
      type: "servicingDraft",
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      value
    };

    let saved = rec;
    if (authToken && navigator.onLine) {
      try {
        saved = await saveServerDraft(rec);
      } catch (e) {
        console.warn("Failed to save draft on server; keeping browser fallback.", e);
      }
    }

    await idbPut(dbRef.current, "servicingCache", saved);
    await refreshDrafts();
    return saved.key || key;
  }

  async function loadDraft(draftKey) {
    setErr("");
    setInfo("");
    if (!dbRef.current) return;

    try {
      const rec = await getDraftRecord(draftKey);
      if (!rec || !rec.value) {
        setErr("Draft not found.");
        return;
      }
      loadDraftValueIntoForm(rec.value);
      setInfo(`Draft loaded: ${rec.name || draftKey}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(String(e?.message || "Failed to load draft."));
    }
  }

  async function renameDraft(draftKey) {
    const newName = window.prompt("Draft name:", "");
    if (newName === null) return;
    const name = String(newName || "").trim();
    if (!name) return;

    setErr("");
    setInfo("");
    if (!dbRef.current) return;

    try {
      const rec = await getDraftRecord(draftKey);
      if (!rec) {
        setErr("Draft not found.");
        return;
      }
      let updated = {
        ...rec,
        name,
        updatedAt: new Date().toISOString()
      };
      if (authToken && navigator.onLine) {
        try {
          updated = await saveServerDraft(updated);
        } catch (e) {
          console.warn("Failed to rename draft on server; keeping browser fallback.", e);
        }
      }
      await idbPut(dbRef.current, "servicingCache", updated);
      await refreshDrafts();
      setInfo("Draft renamed.");
    } catch (e) {
      setErr(String(e?.message || "Failed to rename draft."));
    }
  }

  async function deleteDraft(draftKey) {
    const ok = window.confirm("Delete this draft?");
    if (!ok) return;

    setErr("");
    setInfo("");
    if (!dbRef.current) return;

    try {
      if (authToken && navigator.onLine) {
        try {
          await deleteServerDraft(draftKey);
        } catch (e) {
          console.warn("Failed to delete draft on server; removing browser copy.", e);
        }
      }
      await idbDelete(dbRef.current, "servicingCache", draftKey);
      await refreshDrafts();
      setInfo("Draft deleted.");
    } catch (e) {
      setErr(String(e?.message || "Failed to delete draft."));
    }
  }

  function makeSelectedStandardsFromValue(v) {
    return standardsFromDraftValue(v);
  }

  function buildQuestionRowsForDraftValue(v) {
    const snap = Array.isArray(v?.questionRowsSnapshot) ? v.questionRowsSnapshot : [];
    if (snap.length) {
      return snap
        .map((q, idx) => ({
          id: q?.id || makeQid(q?.std || "General", q?.question || `Question ${idx + 1}`, idx),
          std: q?.std || "General",
          question: String(q?.question || "").trim(),
          extra: q?.extra || ""
        }))
        .filter((q) => q.question);
    }

    const draftStandards = makeSelectedStandardsFromValue(v);
    const draftFrequencyKey = normalizeServiceToFreqKey(v?.serviceType);
    if (!checklist || !draftStandards.length) return [];

    const draftMerged = mergeQuestions(checklist, draftFrequencyKey, draftStandards);
    const rows = [];
    Object.keys(draftMerged || {}).forEach((std) => {
      const list = draftMerged[std] || [];
      list.forEach((q, idx) => {
        const qText = String(q?.question || "").trim();
        if (!qText) return;
        rows.push({
          id: makeQid(std, qText, idx),
          std,
          question: qText,
          extra: q?.extra ?? ""
        });
      });
    });
    return rows;
  }

  function validateDraftValueForGeneration(v, draftQuestionRows) {
    if (!v?.area) return "Draft is missing Area.";
    if (!v?.serviceType) return "Draft is missing Service Type.";

    const standards = makeSelectedStandardsFromValue(v);
    if (!standards.length) return "Draft is missing selected standards.";

    if (!draftQuestionRows.length) {
      return "Draft questions are unavailable. Open the draft and save it again, then try Generate.";
    }

    const draftAnswers = v?.answers || {};
    const unanswered = draftQuestionRows.filter((q) => !draftAnswers?.[q.id]?.answer).length;
    if (unanswered > 0) return `Draft is incomplete. Unanswered: ${unanswered}`;

    const missingPhotos = draftQuestionRows.filter((q) => {
      const a = draftAnswers?.[q.id] || {};
      const need = needsPhotoForAnswer(q.std, a.answer);
      return need && !a.photoDataUrl && !a.photoFile;
    }).length;

    if (missingPhotos > 0) return `Draft is incomplete. Missing required photos: ${missingPhotos}`;

    return "";
  }

  async function enqueueServicingJobFromValue(draftValue, nameHint, draftKey = "") {
    setErr("");
    setInfo("");

    if (!authToken) {
      setErr("Not logged in.");
      return;
    }
    if (!dbRef.current) {
      setErr("Offline storage not available in this browser.");
      return;
    }

    const v = draftValue || {};
    const draftQuestionRows = buildQuestionRowsForDraftValue(v);
    const validationMsg = validateDraftValueForGeneration(v, draftQuestionRows);
    if (validationMsg) {
      setErr(validationMsg);
      return;
    }

    setSubmitting(true);

    try {
      const reportId = makeReportId();
      const createdAt = new Date().toISOString();
      const standards = makeSelectedStandardsFromValue(v);
      const draftFrequencyKey = normalizeServiceToFreqKey(v.serviceType);
      const baseName = String(nameHint || "").trim() || buildServerStyleBaseName(v.area, v.serviceType, createdAt, reportId);
      const serverFileName = `${baseName}.docx`;

      const payload = {
        reportId, // ✅ durable id used server-side to prevent overwriting
        technician: authUser?.name || authUser?.email || "Unknown",
        area: v.area,
        service: v.serviceType,
        systemType: v.systemType || "substation",
        checklistType: v.systemType || "substation",
        frequencyKey: draftFrequencyKey,
        standards,
        createdAt,
        correctionOfReport: correctionContext?.correctionOf || "",
        correctionReason: correctionContext?.reason || "",
        svcNumber: reportId,
        serverFileName,
        signatureDataUrl: v.signatureDataUrl || "",
        responses: draftQuestionRows.map((q, i) => ({
          no: i + 1,
          qid: q.id,
          photoField: `photo_${q.id}`,
          standard: q.std,
          question: q.question,
          answer: v?.answers?.[q.id]?.answer || "",
          comment: v?.answers?.[q.id]?.comment || "",
          extraType: q.extra || "",
          extra: v?.answers?.[q.id]?.extra || {}
        }))
      };

      // Collect attachments as blobs from saved draft dataUrls
      const attachments = [];
      draftQuestionRows.forEach((q) => {
        const a = v?.answers?.[q.id] || {};
        const field = `photo_${q.id}`;

        if (a.photoFile) {
          attachments.push({
            field,
            fileName: `${field}.jpg`,
            blob: a.photoFile
          });
          return;
        }

        if (a.photoDataUrl) {
          const b = blobFromDataUrl(a.photoDataUrl);
          if (b) {
            attachments.push({
              field,
              fileName: `${field}.jpg`,
              blob: b
            });
          }
        }
      });

      const job = {
        id: makeJobId(),
        reportId,
        type: "servicing_generate",
        schemaVersion: 2,
        status: "queued",
        retries: 0,
        createdAt,
        summary: {
          area: v.area,
          serviceType: v.serviceType,
          technician: authUser?.name || authUser?.email || "Unknown"
        },
        draftKey: String(draftKey || ""),
        payload,
        attachments,
        result: { fileName: "", url: "" },
        error: ""
      };

      await idbPut(dbRef.current, "servicingJobs", job);
      await refreshJobs();

      setInfo(navigator.onLine ? "Draft queued and will submit to server in the background." : "Draft queued offline. It will submit when online.");

      emitJobsEvent();
    } catch (e) {
      setErr(String(e?.message || "Failed to queue report generation."));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveCurrentAsDraftOnly() {
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (!dbRef.current) {
      setErr("Offline storage not available in this browser.");
      return;
    }

    if (unansweredCount > 0) {
      setErr(`Please answer all questions before saving the draft. Unanswered: ${unansweredCount}`);
      return;
    }

    if (photoMissingCount > 0) {
      setErr(`Please take required photos before saving the draft. Missing: ${photoMissingCount}`);
      return;
    }

    try {
      if (!signatureDataUrl && signatureTouched) captureSignatureNow();

      const value = {
        ...buildDraftValue(),
        signatureDataUrl: signatureDataUrl || ""
      };
      const name = buildDraftNameFromValue(value, Date.now());
      await saveDraftRecord(name, value);
      setInfo(`Draft saved: ${name}`);
    } catch (e) {
      setErr(String(e?.message || "Failed to save draft."));
    }
  }

  async function generateFromDraft(draftKey) {
    setErr("");
    setInfo("");

    if (!dbRef.current) return;

    try {
      const rec = await getDraftRecord(draftKey);
      if (!rec || !rec.value) {
        setErr("Draft not found.");
        return;
      }

      await enqueueServicingJobFromValue(rec.value, rec.name || "", rec.key || draftKey);
    } catch (e) {
      setErr(String(e?.message || "Failed to generate from draft."));
    }
  }

  async function removeJob(id) {
    if (!dbRef.current) return;
    await idbDelete(dbRef.current, "servicingJobs", id);
    await refreshJobs();
    emitJobsEvent();
  }

  async function retryJob(id) {
    if (!dbRef.current) return;
    const job = await idbGet(dbRef.current, "servicingJobs", id);
    if (!job) return;
    const updated = { ...job, status: "queued", error: "", lastUpdateAt: new Date().toISOString() };
    await idbPut(dbRef.current, "servicingJobs", updated);
    await refreshJobs();
    setInfo("Job re-queued.");
    emitJobsEvent();
  }

  function resetToStart() {
    setErr("");
    setInfo("");
    setStep(0);
    setArea("");
    setAreaSearch("");
    setAreaOpen(false);
    setServiceType("");
    setSelectedStandardsState(defaultStandardsForChecklist(checklist));
    setAnswers({});
    setHighlightMissing(false);
    setHighlightMissingPhotos(false);

    setSignatureDataUrl("");
    setSignatureTouched(false);
  }

  if (!canAccess) {
    return <Alert variant="danger">Access denied.</Alert>;
  }

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div>
          <h4 className="mb-0">Servicing</h4>
          <small className="text-muted">Mobile workflow (Pre-Start → Questionnaire → Review → Final)</small>
          {!online ? (
            <div className="mt-1">
              <Badge bg="warning" text="dark">Offline mode</Badge>
              <span className="text-muted small ms-2">Using cached data. Draft generation jobs will queue until online.</span>
            </div>
          ) : null}
        </div>

        <div className="d-flex align-items-center" style={{ gap: 8 }}>
          <Badge bg="info">Step {step + 1} / 4</Badge>

          <Button
            variant="outline-secondary"
            size="sm"
            onClick={loadListsAndChecklist}
            disabled={loadingLists || loadingChecklist || submitting}
          >
            {loadingLists || loadingChecklist ? (
              <>
                <Spinner size="sm" className="me-2" /> Loading…
              </>
            ) : (
              "Refresh"
            )}
          </Button>

          <Button
            variant="outline-primary"
            size="sm"
            onClick={refreshJobs}
            disabled={!dbReady || loadingJobs}
          >
            {loadingJobs ? (
              <>
                <Spinner size="sm" className="me-2" /> Jobs…
              </>
            ) : (
              "Jobs"
            )}
          </Button>
        </div>
      </div>

      <Card border="light" className="shadow-sm mb-3">
        <Card.Body>
          <div className="mb-2">
            <ProgressBar now={progress} label={`${progress}%`} style={{ height: "20px" }} />
          </div>

          <div ref={topRef} />

          {err ? <Alert variant="danger" className="mb-2">{err}</Alert> : null}
          {correctionContext ? (
            <Alert variant="warning" className="mb-2">
              Creating corrected follow-up for <strong>{correctionContext.correctionOf}</strong>
              {correctionContext.reason ? <div className="mt-1">Reject reason: {correctionContext.reason}</div> : null}
            </Alert>
          ) : null}
          {info ? <Alert variant="info" className="mb-0">{info}</Alert> : null}
        </Card.Body>
      </Card>

      {/* JOB QUEUE (always visible, compact) */}
      {dbReady ? (
        <Card border="light" className="shadow-sm mb-3">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <div className="fw-bold">Generation Queue</div>
            <div className="text-muted small">{jobs.length} job(s)</div>
          </Card.Header>
          <Card.Body>
            {!jobs.length ? (
              <div className="text-muted small">No queued jobs.</div>
            ) : (
              jobs.slice(0, 10).map((j) => (
                <div key={j.id} className="d-flex justify-content-between align-items-center flex-wrap mb-2" style={{ gap: 10 }}>
                  <div>
                    <div className="fw-bold">
                      {j.summary?.area || "-"} • {j.summary?.serviceType || "-"}
                    </div>
                    <div className="text-muted small">
                      {j.createdAt ? new Date(j.createdAt).toLocaleString() : ""} • {j.status}
                      {j.reportId ? ` • ${j.reportId}` : ""}
                      {j.error ? ` • ${j.error}` : ""}
                      {j.schemaVersion ? ` • v${j.schemaVersion}` : ""}
                    </div>
                  </div>

                  <div className="d-flex align-items-center" style={{ gap: 8 }}>
                    {j.status === "done" && j.result?.url ? (
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => downloadFile(j.result.url, j.result.fileName)}
                      >
                        Download
                      </Button>
                    ) : null}

                    {j.status === "error" ? (
                      <Button variant="outline-warning" size="sm" onClick={() => retryJob(j.id)}>
                        Retry
                      </Button>
                    ) : null}

                    <Button variant="outline-danger" size="sm" onClick={() => removeJob(j.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
            <div className="text-muted small mt-2">
              When online, jobs submit to the server and the server worker generates in the background (even if you close the app).
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* ✅ DRAFTS (always visible, compact) */}
      {dbReady ? (
        <Card border="light" className="shadow-sm mb-3">
          <Card.Header className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
            <div className="fw-bold">Saved Drafts</div>
            <div className="text-muted small">{drafts.length} draft(s)</div>
          </Card.Header>
          <Card.Body>
            {loadingDrafts ? (
              <div className="text-muted small">
                <Spinner size="sm" className="me-2" /> Loading drafts…
              </div>
            ) : !drafts.length ? (
              <div className="text-muted small">No saved drafts.</div>
            ) : (
              drafts.slice(0, 8).map((d) => (
                <div key={d.key} className="d-flex justify-content-between align-items-start flex-wrap mb-2" style={{ gap: 10 }}>
                  <div>
                    <div className="fw-bold">{d.name || d.key}</div>
                    <div className="text-muted small">Updated: {formatDateTimeLocal(d.updatedAt || d.createdAt)}</div>
                  </div>

                  <div className="d-flex align-items-center" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Button variant="primary" size="sm" onClick={() => loadDraft(d.key)} disabled={submitting}>
                      Load
                    </Button>
                    <Button variant="success" size="sm" onClick={() => generateFromDraft(d.key)} disabled={submitting}>
                      Generate
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={() => renameDraft(d.key)} disabled={submitting}>
                      Rename
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={() => deleteDraft(d.key)} disabled={submitting}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}

            {drafts.length > 8 ? (
              <div className="text-muted small mt-2">Showing latest 8 drafts.</div>
            ) : null}

            <div className="text-muted small mt-2">
              Save the draft in the Final step, then use <strong>Generate</strong> here to queue report generation.
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 1: PRESTART */}
      {step === 0 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Pre-Start</h5>
            <div className="text-muted small">
              Frequency key: <span className="fw-bold">{frequencyKey}</span>
            </div>
          </Card.Header>
          <Card.Body>
            <Row className="g-3">
              <Col md={12}>
                <Form.Group>
                  <Form.Label>System Type</Form.Label>
                  <Form.Select
                    value={systemType}
                    onChange={(e) => {
                      const next = e.target.value === "conveyor" ? "conveyor" : "substation";
                      setSystemType(next);
                      setChecklist(null);
                      setAnswers({});
                      setSelectedStandardsState([]);
                      setStep(0);
                    }}
                    disabled={loadingChecklist}
                  >
                    <option value="substation">Substation</option>
                    <option value="conveyor">Conveyor</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Area</Form.Label>

                  {/* ✅ UPDATED: Area dropdown with embedded search */}
                  <div ref={areaBoxRef} style={{ position: "relative" }}>
                    <Form.Control
                      ref={areaInputRef}
                      placeholder="Choose Area…"
                      value={areaOpen ? areaSearch : (area || "")}
                      disabled={loadingLists}
                      onFocus={() => {
                        if (!areaOpen) setAreaSearch("");
                        setAreaOpen(true);
                        window.setTimeout(() => {
                          try {
                            const el = areaInputRef.current;
                            if (el && typeof el.select === "function") el.select();
                          } catch {}
                        }, 0);
                      }}
                      onClick={() => setAreaOpen(true)}
                      onChange={(e) => {
                        setAreaSearch(e.target.value);
                        setAreaOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setAreaOpen(false);
                          return;
                        }
                        if (e.key === "Enter") {
                          const first = (filteredAreaOptions || [])[0];
                          if (first) {
                            setArea(first);
                            setAreaSearch("");
                            setAreaOpen(false);
                          }
                        }
                      }}
                      onBlur={() => {
                        try {
                          if (areaCloseTimerRef.current) window.clearTimeout(areaCloseTimerRef.current);
                          areaCloseTimerRef.current = window.setTimeout(() => setAreaOpen(false), 120);
                        } catch {
                          setAreaOpen(false);
                        }
                      }}
                    />

                    {areaOpen ? (
                      <div
                        style={{
                          position: "absolute",
                          zIndex: 50,
                          top: "100%",
                          left: 0,
                          right: 0,
                          background: "#fff",
                          border: "1px solid #ced4da",
                          borderTop: "none",
                          borderRadius: "0 0 8px 8px",
                          maxHeight: 260,
                          overflowY: "auto",
                          boxShadow: "0 8px 18px rgba(0,0,0,0.08)"
                        }}
                      >
                        {filteredAreaOptions.length ? (
                          filteredAreaOptions.map((opt) => (
                            <div
                              key={opt}
                              role="button"
                              tabIndex={0}
                              onMouseDown={(ev) => {
                                // prevent blur before click registers
                                ev.preventDefault();
                              }}
                              onClick={() => {
                                setArea(opt);
                                setAreaSearch("");
                                setAreaOpen(false);
                              }}
                              style={{
                                padding: "10px 12px",
                                cursor: "pointer",
                                background: opt === area ? "rgba(13,110,253,0.08)" : "#fff",
                                borderBottom: "1px solid rgba(0,0,0,0.06)"
                              }}
                            >
                              <div className="fw-bold" style={{ fontSize: 14 }}>{opt}</div>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: "10px 12px" }} className="text-muted small">
                            No areas match “{String(areaSearch || "").trim()}”.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Service Type</Form.Label>
                  <Form.Select value={serviceType} onChange={(e) => setServiceType(e.target.value)} disabled={loadingLists}>
                    <option value="">Choose Service…</option>
                    {serviceOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Label>Standards</Form.Label>
                <div className="d-flex flex-wrap" style={{ gap: 14 }}>
                  {availableStandards.length ? (
                    availableStandards.map((std) => (
                      <Form.Check
                        key={std}
                        type="checkbox"
                        label={std}
                        checked={selectedStandards.includes(std)}
                        onChange={(e) => {
                          const checked = !!e.target.checked;
                          setSelectedStandardsState((prev) => {
                            const cur = new Set(prev || []);
                            if (checked) cur.add(std);
                            else cur.delete(std);
                            return Array.from(cur);
                          });
                        }}
                      />
                    ))
                  ) : (
                    <span className="text-muted small">Standards load from the selected checklist.</span>
                  )}
                </div>
              </Col>

              <Col md={12}>
                {!checklist ? (
                  <Alert variant="warning" className="mb-0">
                    Checklist not loaded yet. Confirm backend route: <span className="fw-bold">GET /api/servicing/checklist</span>
                  </Alert>
                ) : (
                  <Alert variant="success" className="mb-0">
                    Checklist loaded for {systemType === "conveyor" ? "Conveyor" : "Substation"}.
                  </Alert>
                )}
              </Col>
            </Row>
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 2: QUESTIONNAIRE */}
      {step === 1 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Questionnaire</h5>
            <small className="text-muted">{systemType === "conveyor" ? "Conveyor" : "Substation"} • {area} • {serviceType} • Unanswered: {unansweredCount} • Photos missing: {photoMissingCount}</small>
          </Card.Header>
          <Card.Body>
            {!questionRows.length ? (
              <Alert variant="warning" className="mb-0">
                No questions found for the selected frequency/standards.
              </Alert>
            ) : (
              questionRows.map((q, idx) => {
                const a = answers?.[q.id] || { answer: "", comment: "", photoDataUrl: "", photoFile: null };
                const needPhoto = needsPhotoForAnswer(q.std, a.answer);
                const showMissing =
                  (highlightMissing && !a.answer) || (highlightMissingPhotos && needPhoto && !a.photoFile && !a.photoDataUrl);

                return (
                  <Card key={q.id} className="mb-3" style={showMissing ? { border: "1px solid #dc3545" } : undefined}>
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start" style={{ gap: 10 }}>
                        <div>
                          <div className="fw-bold mb-1">{idx + 1}. {q.question}</div>
                          <div className="text-muted small">{q.std}{q.extra ? ` • extra: ${q.extra}` : ""}</div>
                        </div>
                      </div>

                      <Row className="g-2 mt-2">
                        <Col md={4}>
                          <Form.Select
                            value={a.answer || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateAnswer(q.id, { answer: val });

                              const need = needsPhotoForAnswer(q.std, val);
                              const has = !!(a.photoFile || a.photoDataUrl);
                              if (need && !has) {
                                window.setTimeout(() => triggerPhotoPicker(q.id), 0);
                              }
                            }}
                          >
                            {answerOptionsForStd(q.std).map((opt) => (
                              <option key={opt.v} value={opt.v}>{opt.l}</option>
                            ))}
                          </Form.Select>
                        </Col>

                        <Col md={8}>
                          <Form.Control
                            placeholder="Comment (optional)"
                            value={a.comment || ""}
                            onChange={(e) => updateAnswer(q.id, { comment: e.target.value })}
                          />
                        </Col>
                      </Row>

                      {(needPhoto || a.photoDataUrl || a.photoFile) ? (
                        <div className="mt-3">
                          <div className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
                            <div className="fw-bold">
                              Photo required ({isGeneralStd(q.std) ? "YES" : "FAIL"} selected)
                            </div>

                            <div className="d-flex align-items-center" style={{ gap: 8 }}>
                              {(a.photoDataUrl || a.photoFile) ? <Badge bg="success">Captured</Badge> : <Badge bg="secondary">Not captured</Badge>}

                              {(a.photoDataUrl || a.photoFile) ? (
                                <Button type="button" variant="outline-secondary" size="sm" onClick={() => clearPhoto(q.id)}>
                                  Clear
                                </Button>
                              ) : null}

                              <Button
                                type="button"
                                variant={(!a.photoDataUrl && !a.photoFile) ? "primary" : "outline-primary"}
                                size="sm"
                                onClick={() => triggerPhotoPicker(q.id)}
                              >
                                Take photo
                              </Button>
                            </div>
                          </div>

                          <input
                            type="file"
                            accept="image/*"
                            {...(isMobile ? { capture: "environment" } : {})}
                            style={{ display: "none" }}
                            ref={(el) => {
                              if (el) photoInputRefs.current[q.id] = el;
                            }}
                            onChange={(e) => {
                              const file = e.target.files && e.target.files[0];
                              onPhotoSelected(q.id, file);
                            }}
                          />

                          {highlightMissingPhotos && needPhoto && !a.photoFile && !a.photoDataUrl ? (
                            <div className="text-danger small mt-2">
                              Please take a photo for this question before continuing.
                            </div>
                          ) : null}

                          {a.photoDataUrl ? (
                            <div className="mt-2">
                              <img
                                src={a.photoDataUrl}
                                alt="Captured"
                                style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #ced4da" }}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </Card.Body>
                  </Card>
                );
              })
            )}
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 3: REVIEW */}
      {step === 2 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Review</h5>
            <small className="text-muted">Unanswered: {unansweredCount}</small>
          </Card.Header>
          <Card.Body>
            <Alert variant="info">Review screen before saving the draft.</Alert>

            <div className="mb-2"><strong>Technician:</strong> {authUser?.name || authUser?.email || "-"}</div>
            <div className="mb-2"><strong>System Type:</strong> {systemType === "conveyor" ? "Conveyor" : "Substation"}</div>
            <div className="mb-2"><strong>Area:</strong> {area}</div>
            <div className="mb-2"><strong>Service Type:</strong> {serviceType}</div>
            <div className="mb-3">
              <strong>Standards:</strong> {selectedStandards.length ? selectedStandards.join(", ") : "-"}
            </div>

            <hr />

            {questionRows.map((q, idx) => {
              const a = answers?.[q.id] || {};
              return (
                <div key={q.id} className="mb-3">
                  <div className="fw-bold">{idx + 1}. {q.question}</div>
                  <div className="text-muted small">
                    [{q.std}] Answer: {a.answer || "-"} | Comment: {a.comment || "-"} | Photo: {(a.photoDataUrl || a.photoFile) ? "Yes" : "No"}
                  </div>
                </div>
              );
            })}

            <hr />

            <Card className="mb-0">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
                  <div>
                    <div className="fw-bold">Signature</div>
                    <div className="text-muted small">Draw below (touch or mouse). Saved as PNG when you press Next.</div>
                  </div>

                  <div className="d-flex align-items-center" style={{ gap: 8 }}>
                    {signatureDataUrl ? <Badge bg="success">Captured</Badge> : <Badge bg="secondary">Not captured</Badge>}
                    <Button variant="outline-secondary" size="sm" onClick={clearSignature}>Clear</Button>
                  </div>
                </div>

                <div
                  className="mt-3"
                  style={{
                    border: "1px solid #ced4da",
                    borderRadius: 8,
                    background: "#fff",
                    width: "100%",
                    height: 220,
                    touchAction: "none"
                  }}
                >
                  <canvas
                    ref={sigCanvasRef}
                    style={{ width: "100%", height: "100%", display: "block", borderRadius: 8 }}
                    onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} beginSignature(e); }}
                    onPointerMove={moveSignature}
                    onPointerUp={endSignature}
                    onPointerCancel={endSignature}
                    onMouseDown={beginSignature}
                    onMouseMove={moveSignature}
                    onMouseUp={endSignature}
                    onMouseLeave={endSignature}
                    onTouchStart={beginSignature}
                    onTouchMove={moveSignature}
                    onTouchEnd={endSignature}
                    onTouchCancel={endSignature}
                  />
                </div>

                <div className="text-muted small mt-2">
                  Signature will be captured as PNG when you press Next.
                </div>
              </Card.Body>
            </Card>
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 4: FINAL */}
      {step === 3 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header>
            <h5 className="mb-0">Final</h5>
          </Card.Header>
          <Card.Body>
            <Alert variant="warning">
              This step now saves a draft only. Use the <strong>Generate</strong> button in Saved Drafts to queue the report.
            </Alert>

            <div className="d-flex flex-wrap" style={{ gap: 10 }}>
              <Button variant="success" onClick={saveCurrentAsDraftOnly} disabled={submitting || unansweredCount > 0}>
                {submitting ? (
                  <>
                    <Spinner size="sm" className="me-2" /> Saving…
                  </>
                ) : (
                  "Save Draft"
                )}
              </Button>

              <Button variant="secondary" onClick={resetToStart} disabled={submitting}>
                Start New
              </Button>
            </div>

            <div className="text-muted small mt-2">
              Tip: If offline, drafts still save locally. Generated draft jobs stay queued and submit automatically when you’re back online.
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* NAV BUTTONS */}
      <div className="d-flex justify-content-between mt-3">
        <Button variant="secondary" onClick={back} disabled={step === 0}>
          Back
        </Button>

        <Button variant={step === 3 ? "secondary" : "primary"} onClick={step === 3 ? resetToStart : next}>
          {step === 3 ? "Close" : "Next"}
        </Button>
      </div>
    </>
  );
}
