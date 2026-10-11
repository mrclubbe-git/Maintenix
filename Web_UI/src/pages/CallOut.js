import React, { useEffect, useMemo, useState, useRef } from "react";
import { Card, Row, Col, Button, Form, Alert, ProgressBar, Badge, Spinner } from "@themesberg/react-bootstrap";
import { addGlobalArea, fetchGlobalAreas, hasExactAreaMatch } from "../lib/globalAreas";

function CallOutButton({ variant = "primary", disabled = false, style, children, ...props }) {
  return (
    <Button
      {...props}
      variant={variant}
      size="sm"
      disabled={disabled}
      style={{
        fontWeight: 700,
        ...style
      }}
    >
      {children}
    </Button>
  );
}

function ChecklistOptionPill({ active, tone, icon, children, onClick }) {
  return (
    <CallOutButton
      variant={active ? tone : `outline-${tone}`}
      aria-pressed={active}
      onClick={onClick}
      style={{
        minWidth: 0,
        transition: "background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease, transform 150ms ease",
        boxShadow: active ? "0 2px 6px rgba(0, 0, 0, 0.14)" : undefined,
        transform: active ? "translateY(-1px)" : undefined
      }}
    >
      <span aria-hidden="true" className="me-1">{icon}</span>
      <span>{children}</span>
    </CallOutButton>
  );
}

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

function localCallOutTimestamp(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const offsetMinutes = -d.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetAbs = Math.abs(offsetMinutes);
  const offset = `${offsetSign}${pad(Math.floor(offsetAbs / 60))}:${pad(offsetAbs % 60)}`;
  return {
    at: `${date}T${time}${offset}`,
    date,
    time
  };
}

const CALL_OUT_QUESTIONS = [
  { id: "system_defective", question: "Is the system defective?" },
  { id: "defect_resolved", question: "Could the defect be resolved?" }
];

function emptyCallOutAnswer(questionId) {
  return questionId === "defect_resolved"
    ? { answer: "", comment: "", photos: [], requirements: [""] }
    : { answer: "", comment: "", photos: [], requirements: [] };
}

function normalizeCallOutPhotos(record) {
  const photos = Array.isArray(record?.photos) ? record.photos : [];
  return photos
    .map((photo) => ({
      dataUrl: String(photo?.dataUrl || ""),
      file: photo?.file || null,
      name: String(photo?.name || ""),
      comment: String(photo?.comment || "")
    }))
    .filter((photo) => photo.dataUrl || photo.file);
}

function normalizeRequirements(record) {
  return Array.isArray(record?.requirements)
    ? record.requirements.map((value) => String(value || ""))
    : [];
}

function callOutResponseComplete(questionId, record) {
  const answer = String(record?.answer || "").trim().toUpperCase();

  if (questionId === "system_defective") {
    if (answer === "NO") return true;
    if (answer !== "YES") return false;
    const photos = normalizeCallOutPhotos(record);
    return !!String(record?.comment || "").trim()
      && photos.length > 0
      && photos.every((photo) => photo.comment.trim());
  }

  if (questionId === "defect_resolved") {
    if (answer === "YES") {
      const photos = normalizeCallOutPhotos(record);
      return !!String(record?.comment || "").trim()
        && photos.length > 0
        && photos.every((photo) => photo.comment.trim());
    }
    if (answer === "NO") {
      const requirements = normalizeRequirements(record);
      return requirements.length > 0 && requirements.every((value) => value.trim());
    }
  }

  return false;
}

function callOutMissingPhotos(questionId, record) {
  const answer = String(record?.answer || "").trim().toUpperCase();
  return answer === "YES" && normalizeCallOutPhotos(record).length === 0 ? 1 : 0;
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


function defectStateFromAnswer(answer) {
  const value = String(answer || "").trim().toUpperCase();
  if (value === "FAIL" || value === "YES") return "yes";
  if (value === "PASS" || value === "NO") return "no";
  if (value === "N/A") return "na";
  return "";
}

function legacyAnswerForDefectState(std, state) {
  if (state === "yes") return isGeneralStd(std) ? "YES" : "FAIL";
  if (state === "no") return isGeneralStd(std) ? "NO" : "PASS";
  if (state === "na") return "N/A";
  return "";
}

function normalizeDefects(record) {
  const source = Array.isArray(record?.defects)
    ? record.defects
    : Array.isArray(record?.defectEntries)
      ? record.defectEntries
      : [];

  return source.map((defect) => ({
    finding: String(defect?.finding || ""),
    photoDataUrl: String(defect?.photoDataUrl || ""),
    photoFile: defect?.photoFile || null,
    photoField: String(defect?.photoField || "")
  }));
}

function defectHasPhoto(defect, record, defectIndex) {
  if (defect?.photoFile || defect?.photoDataUrl) return true;
  // Older drafts stored one question-level photo. Treat it as defect 1.
  return defectIndex === 0 && !!(record?.photoFile || record?.photoDataUrl);
}

function generalPhotoPresent(record) {
  const defects = normalizeDefects(record);
  if (defects.some((defect, defectIndex) => defectHasPhoto(defect, record, defectIndex))) return true;
  return !!(record?.photoFile || record?.photoDataUrl);
}

function countMissingRequiredPhotos(record, std) {
  if (isGeneralStd(std)) {
    const answer = String(record?.answer || "").trim().toUpperCase();
    return answer === "YES" && !generalPhotoPresent(record) ? 1 : 0;
  }

  const state = String(record?.defectsFound || "").trim().toLowerCase() || defectStateFromAnswer(record?.answer);
  if (state !== "yes") return 0;
  const defects = normalizeDefects(record);
  if (!defects.length) return 1;
  return defects.reduce((count, defect, defectIndex) => (
    count + (defectHasPhoto(defect, record, defectIndex) ? 0 : 1)
  ), 0);
}

function servicingResponseComplete(record, std) {
  if (isGeneralStd(std)) {
    const answer = String(record?.answer || "").trim().toUpperCase();
    if (answer === "YES") return generalPhotoPresent(record);
    if (answer === "NO" || answer === "N/A") return !!String(record?.comment || "").trim();
    return false;
  }

  const explicitState = String(record?.defectsFound || "").trim().toLowerCase();
  if (!explicitState) {
    const legacyState = defectStateFromAnswer(record?.answer);
    if (legacyState !== "yes") return !!String(record?.answer || "").trim();
  }

  const state = explicitState || defectStateFromAnswer(record?.answer);
  if (state === "no" || state === "na") return true;
  if (state !== "yes") return false;

  const defects = normalizeDefects(record);
  return defects.length > 0 && defects.every((defect, defectIndex) => (
    defect.finding.trim() && defectHasPhoto(defect, record, defectIndex)
  ));
}

function defectsAsComment(defects) {
  const list = Array.isArray(defects) ? defects : [];
  return list
    .map((defect, index) => {
      const finding = String(defect?.finding || "").trim();
      if (!finding) return "";
      return `Defect ${index + 1}: ${finding}`;
    })
    .filter(Boolean)
    .join("\n");
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
    const req = indexedDB.open("maintenix_callout_v2");
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("calloutCache")) {
        db.createObjectStore("calloutCache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("calloutJobs")) {
        const s = db.createObjectStore("calloutJobs", { keyPath: "id" });
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
  return `co_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ Draft helpers
function makeDraftKey() {
  return `callout_v2_draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
  return "maintenix_callout_v2_runner_lock";
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

export default function CallOut() {
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

  // Shared Call Out photo inputs.
  const callOutCameraInputRef = useRef(null);
  const callOutPictureInputRef = useRef(null);
  const callOutPhotoTargetRef = useRef({ qid: "" });

  // Steps: 0=PreStart, 1=Questionnaire, 2=Review, 3=Draft creation progress
  const [step, setStep] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [draftProgress, setDraftProgress] = useState(0);
  const [draftProgressText, setDraftProgressText] = useState("");

  // Prestart
  const [area, setArea] = useState("");
  const [callOutStartAt, setCallOutStartAt] = useState("");
  const [callOutStartDate, setCallOutStartDate] = useState("");
  const [callOutStartTime, setCallOutStartTime] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [areaOpen, setAreaOpen] = useState(false); // ✅ dropdown open state
  const areaBoxRef = useRef(null); // ✅ outside click detection
  const areaInputRef = useRef(null); // ✅ focus/select behavior
  const areaCloseTimerRef = useRef(null); // ✅ blur delay to allow click

  // Loaded lists
  const [areaOptions, setAreaOptions] = useState([]);
  const [addingArea, setAddingArea] = useState(false);

  // Shared Area list
  const [loadingLists, setLoadingLists] = useState(false);

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
    window.addEventListener("maintenix:callout-v2-jobs", onJobEvent);

    return () => {
      mounted = false;
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
      window.removeEventListener("maintenix:callout-v2-jobs", onJobEvent);
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

  const canAddArea = useMemo(() => {
    const candidate = String(areaSearch || "").replace(/\s+/g, " ").trim();
    return !!candidate && !hasExactAreaMatch(areaOptions, candidate);
  }, [areaOptions, areaSearch]);

  async function createGlobalAreaFromSearch() {
    const candidate = String(areaSearch || "").replace(/\s+/g, " ").trim();
    if (!candidate || addingArea) return;

    setErr("");
    setInfo("");
    setAddingArea(true);

    try {
      const result = await addGlobalArea(authToken, candidate);
      const updatedAreas = result.areas.length
        ? result.areas
        : Array.from(new Set([...(areaOptions || []), result.area]));

      setAreaOptions(updatedAreas);
      setArea(result.area);
      setAreaSearch("");
      setAreaOpen(false);
      await cacheSet("areas", updatedAreas);
      setInfo(result.created ? `Area added: ${result.area}` : `Area selected: ${result.area}`);
    } catch (e) {
      setErr(String(e?.message || "Failed to add area."));
    } finally {
      setAddingArea(false);
    }
  }

  const questionRows = CALL_OUT_QUESTIONS;
  const [answers, setAnswers] = useState({
    system_defective: emptyCallOutAnswer("system_defective"),
    defect_resolved: emptyCallOutAnswer("defect_resolved")
  });

  const systemDefectiveAnswer = String(answers?.system_defective?.answer || "").trim().toUpperCase();
  const applicableQuestionRows = systemDefectiveAnswer === "YES" ? questionRows : [questionRows[0]];

  const unansweredCount = useMemo(
    () => applicableQuestionRows.filter((q) => !callOutResponseComplete(q.id, answers?.[q.id] || {})).length,
    [applicableQuestionRows, answers]
  );

  const completedCount = useMemo(
    () => Math.max(0, applicableQuestionRows.length - unansweredCount),
    [applicableQuestionRows.length, unansweredCount]
  );

  const defectsFoundCount = systemDefectiveAnswer === "YES" ? 1 : 0;

  const photoMissingCount = useMemo(
    () => applicableQuestionRows.reduce((count, q) => count + callOutMissingPhotos(q.id, answers?.[q.id] || {}), 0),
    [applicableQuestionRows, answers]
  );

  const progress = useMemo(() => (step === 3 ? 100 : Math.round(((step + 1) / 3) * 100)), [step]);

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
    await idbPut(dbRef.current, "calloutCache", { key, value, updatedAt: new Date().toISOString() });
  }

  async function cacheGet(key) {
    if (!dbRef.current) return null;
    const rec = await idbGet(dbRef.current, "calloutCache", key);
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
    const data = await apiJson("/api/callout/drafts");
    return Array.isArray(data?.drafts) ? data.drafts : [];
  }

  async function saveServerDraft(rec) {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    const data = await apiJson("/api/callout/drafts", {
      method: "POST",
      body: JSON.stringify(rec)
    });
    return data?.draft || rec;
  }

  async function getServerDraft(key) {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    const data = await apiJson(`/api/callout/drafts/${encodeURIComponent(key)}`);
    return data?.draft || null;
  }

  async function deleteServerDraft(key) {
    if (!authToken || !navigator.onLine) throw new Error("Server drafts unavailable.");
    await apiJson(`/api/callout/drafts/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  async function getDraftRecord(key) {
    if (!dbRef.current) return null;
    return await idbGet(dbRef.current, "calloutCache", key);
  }

  async function refreshJobs() {
    if (!dbRef.current) return;
    setLoadingJobs(true);
    try {
      const all = await idbGetAll(dbRef.current, "calloutJobs");
      const sorted = (all || [])
        .filter((job) => job && job.type === "callout_v2_generate")
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
      const all = await idbGetAll(dbRef.current, "calloutCache");
      const onlyDrafts = (all || [])
        .filter((x) => x && typeof x.key === "string" && x.key.startsWith("callout_v2_draft_") && x.type === "calloutV2Draft")
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

      setDrafts(onlyDrafts);
    } catch {
      // ignore
    } finally {
      setLoadingDrafts(false);
    }
  }

  function emitJobsEvent() {
    try {
      window.dispatchEvent(new Event("maintenix:callout-v2-jobs"));
    } catch {}
  }

  async function loadAreaList() {
    setErr("");
    setInfo("");
    if (!authToken) {
      setErr("Not logged in.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setAreaOptions([]);
      setErr("Internet connection is required. Offline mode is temporarily disabled.");
      return;
    }

    setLoadingLists(true);
    try {
      const areas = await fetchGlobalAreas(authToken);
      setAreaOptions(areas);
      await cacheSet("areas", areas);
    } catch (e) {
      setErr(String(e?.message || "Failed to load the shared Area list."));
    } finally {
      setLoadingLists(false);
    }
  }

  useEffect(() => {
    if (!canAccess) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setErr("Internet connection is required. Offline mode is temporarily disabled.");
      return;
    }
    loadAreaList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, canAccess]);

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
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "Internet connection is required. Offline mode is temporarily disabled.";
    if (!area) return "Please select an Area.";
    return "";
  }

  function primeAnswers() {
    setAnswers((prev) => ({
      system_defective: { ...emptyCallOutAnswer("system_defective"), ...(prev?.system_defective || {}) },
      defect_resolved: { ...emptyCallOutAnswer("defect_resolved"), ...(prev?.defect_resolved || {}) }
    }));
  }

  function updateCallOutAnswer(qid, patch) {
    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer(qid), ...(prev?.[qid] || {}) };
      return { ...prev, [qid]: { ...current, ...patch } };
    });
  }

  function selectCallOutAnswer(qid, answer) {
    const normalized = String(answer || "").trim().toUpperCase();

    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer(qid), ...(prev?.[qid] || {}) };
      const next = { ...prev };

      if (qid === "system_defective") {
        next.system_defective = normalized === "YES"
          ? { ...current, answer: "YES" }
          : { ...emptyCallOutAnswer("system_defective"), answer: "NO" };

        if (normalized === "NO") {
          next.defect_resolved = emptyCallOutAnswer("defect_resolved");
        }
      } else {
        next.defect_resolved = normalized === "YES"
          ? { ...current, answer: "YES", requirements: [] }
          : {
              ...emptyCallOutAnswer("defect_resolved"),
              answer: "NO",
              requirements: normalizeRequirements(current).length ? normalizeRequirements(current) : [""]
            };
      }

      return next;
    });

    if (normalized === "YES") {
      window.setTimeout(() => openCallOutCamera(qid), 0);
    } else if (qid === "defect_resolved" && normalized === "NO") {
      window.setTimeout(() => {
        const input = document.getElementById("callout-requirement-0");
        if (input && typeof input.focus === "function") input.focus();
      }, 120);
    }
  }

  function updateRequirement(index, value) {
    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer("defect_resolved"), ...(prev?.defect_resolved || {}) };
      const requirements = normalizeRequirements(current);
      requirements[index] = value;
      return { ...prev, defect_resolved: { ...current, requirements } };
    });
  }

  function addRequirement() {
    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer("defect_resolved"), ...(prev?.defect_resolved || {}) };
      const requirements = normalizeRequirements(current);
      return { ...prev, defect_resolved: { ...current, requirements: [...requirements, ""] } };
    });
  }

  function removeRequirement(index) {
    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer("defect_resolved"), ...(prev?.defect_resolved || {}) };
      const requirements = normalizeRequirements(current).filter((_, i) => i !== index);
      return {
        ...prev,
        defect_resolved: {
          ...current,
          requirements: requirements.length ? requirements : [""]
        }
      };
    });
  }

  const isMobile = useMemo(() => isMobileDevice(), []);

  function openCallOutCamera(qid) {
    callOutPhotoTargetRef.current = { qid };
    const input = callOutCameraInputRef.current;
    if (input && typeof input.click === "function") input.click();
  }

  function openCallOutPicturePicker(qid) {
    callOutPhotoTargetRef.current = { qid };
    const input = callOutPictureInputRef.current;
    if (input && typeof input.click === "function") input.click();
  }

  const onCallOutPhotoSelected = async (qid, file) => {
    if (!qid || !file) return;
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
      const dataUrl = String(reader.result || "");
      setAnswers((prev) => {
        const current = { ...emptyCallOutAnswer(qid), ...(prev?.[qid] || {}) };
        const photos = normalizeCallOutPhotos(current);
        return {
          ...prev,
          [qid]: {
            ...current,
            photos: [...photos, {
              dataUrl,
              file: prepared,
              name: prepared?.name || file?.name || "photo.jpg",
              comment: ""
            }]
          }
        };
      });
    };
    reader.onerror = () => setErr("Failed to read selected photo.");
    reader.readAsDataURL(prepared);
  };

  function removeCallOutPhoto(qid, photoIndex) {
    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer(qid), ...(prev?.[qid] || {}) };
      const photos = normalizeCallOutPhotos(current).filter((_, index) => index !== photoIndex);
      return { ...prev, [qid]: { ...current, photos } };
    });
  }

  function updateCallOutPhotoComment(qid, photoIndex, value) {
    setAnswers((prev) => {
      const current = { ...emptyCallOutAnswer(qid), ...(prev?.[qid] || {}) };
      const photos = normalizeCallOutPhotos(current);
      if (!photos[photoIndex]) return prev;
      photos[photoIndex] = { ...photos[photoIndex], comment: value };
      return { ...prev, [qid]: { ...current, photos } };
    });
  }

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
    setDraftProgress(0);
    setDraftProgressText("");
  }

  function captureSignatureNow() {
    const canvas = sigCanvasRef.current;
    if (!canvas) return signatureDataUrl || "";
    try {
      const dataUrl = canvas.toDataURL("image/png");
      setSignatureDataUrl(dataUrl);
      return dataUrl;
    } catch {
      return signatureDataUrl || "";
    }
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
      if (!callOutStartAt) {
        const started = localCallOutTimestamp();
        setCallOutStartAt(started.at);
        setCallOutStartDate(started.date);
        setCallOutStartTime(started.time);
      }
      primeAnswers();
      setQuestionIndex(0);
      setHighlightMissing(false);
      setStep(1);
      return;
    }

    if (step === 1) {
      const currentQuestion = questionRows[questionIndex] || questionRows[0];
      const currentAnswer = answers?.[currentQuestion.id] || {};

      if (!callOutResponseComplete(currentQuestion.id, currentAnswer)) {
        setHighlightMissing(true);
        setHighlightMissingPhotos(callOutMissingPhotos(currentQuestion.id, currentAnswer) > 0);
        if (currentQuestion.id === "system_defective") {
          setErr("Please answer whether the system is defective. If Yes, at least one picture and a defect description are required.");
        } else {
          setErr("Please complete the resolution question and all required details before continuing.");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setHighlightMissing(false);
      setHighlightMissingPhotos(false);

      if (currentQuestion.id === "system_defective" && String(currentAnswer.answer || "").toUpperCase() === "YES") {
        setQuestionIndex(1);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Review is submitted with the dedicated Submit button.
    setHighlightMissing(false);
  }

  function back() {
    setErr("");
    setInfo("");
    setHighlightMissing(false);
    setHighlightMissingPhotos(false);

    if (step === 2) {
      setQuestionIndex(systemDefectiveAnswer === "YES" ? 1 : 0);
      setStep(1);
      return;
    }

    if (step === 1 && questionIndex > 0) {
      setQuestionIndex(questionIndex - 1);
      return;
    }

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
      a.download = fileName || "callout_report.docx";
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

    const res = await fetch("/api/callout/submit-payload", {
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

    const res = await fetch(`/api/callout/status/${encodeURIComponent(rid)}`, {
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

  // Call Out report generation will be re-enabled after the cloned checklist is
  // replaced with the final Call Out questions and report payload mapping.

  // ✅ Draft record build/load helpers
  function buildDraftValue(signatureOverride = signatureDataUrl || "") {
    const cleanAnswers = {};
    questionRows.forEach((q) => {
      const a = { ...emptyCallOutAnswer(q.id), ...(answers?.[q.id] || {}) };
      cleanAnswers[q.id] = {
        answer: String(a.answer || "").trim().toUpperCase(),
        comment: String(a.comment || ""),
        requirements: normalizeRequirements(a),
        photos: normalizeCallOutPhotos(a).map((photo) => ({
          dataUrl: photo.dataUrl || "",
          file: null,
          name: photo.name || "",
          comment: photo.comment || ""
        }))
      };
    });

    return {
      step,
      area,
      callOutStartAt,
      callOutStartDate,
      callOutStartTime,
      areaSearch,
      answers: cleanAnswers,
      signatureDataUrl: signatureOverride || "",
      signatureTouched: false,
      questionRowsSnapshot: questionRows.map((q) => ({
        id: q.id,
        question: q.question
      }))
    };
  }

  function loadDraftValueIntoForm(value) {
    const v = value || {};
    setArea(v.area || "");
    setCallOutStartAt(v.callOutStartAt || "");
    setCallOutStartDate(v.callOutStartDate || "");
    setCallOutStartTime(v.callOutStartTime || "");
    setAreaSearch(v.areaSearch || "");
    setAreaOpen(false);

    setAnswers({
      system_defective: { ...emptyCallOutAnswer("system_defective"), ...(v.answers?.system_defective || {}) },
      defect_resolved: { ...emptyCallOutAnswer("defect_resolved"), ...(v.answers?.defect_resolved || {}) }
    });
    setQuestionIndex(0);
    setSignatureDataUrl(v.signatureDataUrl || "");
    setSignatureTouched(false);

    // safest: return user to start (they can Next through)
    setStep(0);

    setHighlightMissing(false);
    setHighlightMissingPhotos(false);
  }

  function buildDraftNameFromValue(value, uniqueSource) {
    const v = value || {};
    return buildServerStyleBaseName(v.area, "CallOut", new Date().toISOString(), uniqueSource || Date.now());
  }

  async function saveDraftRecord(nameOverride, valueOverride) {
    if (!dbRef.current) throw new Error("Offline storage not available in this browser.");

    const key = makeDraftKey();
    const value = valueOverride || buildDraftValue();
    const name = String(nameOverride || "").trim() || buildDraftNameFromValue(value, key);

    const rec = {
      key,
      type: "calloutV2Draft",
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      value
    };

    // Call Out V2 drafts remain browser-backed during the baseline stage.
    // Server draft sync will be re-enabled after the API deployment is confirmed.
    await idbPut(dbRef.current, "calloutCache", rec);
    await refreshDrafts();
    return rec.key || key;
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
      const updated = {
        ...rec,
        name,
        updatedAt: new Date().toISOString()
      };
      await idbPut(dbRef.current, "calloutCache", updated);
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
      await idbDelete(dbRef.current, "calloutCache", draftKey);
      await refreshDrafts();
      setInfo("Draft deleted.");
    } catch (e) {
      setErr(String(e?.message || "Failed to delete draft."));
    }
  }

  function buildQuestionRowsForDraftValue() {
    return questionRows;
  }

  function validateDraftValueForGeneration(v, draftQuestionRows) {
    if (!v?.area) return "Draft is missing Area.";

    const draftAnswers = v?.answers || {};
    const systemAnswer = String(draftAnswers?.system_defective?.answer || "").trim().toUpperCase();
    const applicable = systemAnswer === "YES" ? draftQuestionRows : [draftQuestionRows[0]];
    const incomplete = applicable.filter((q) => !callOutResponseComplete(q.id, draftAnswers?.[q.id] || {})).length;

    if (incomplete > 0) {
      return `Draft is incomplete. Questionnaire items still need required answers, pictures or comments: ${incomplete}`;
    }

    return "";
  }

  async function enqueueCallOutJobFromValue() {
    setErr("");
    setInfo(
      "Report generation is temporarily disabled on the Call Out baseline clone until the Call Out question set and report mapping are defined."
    );
  }

  async function submitReviewAndSaveDraft() {
    setErr("");
    setInfo("");

    if (draftSubmitting) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setErr("Internet connection is required to submit this call-out checklist.");
      return;
    }

    if (!dbRef.current) {
      setErr("Draft storage is not available in this browser.");
      return;
    }

    if (unansweredCount > 0) {
      setErr(`Please complete every Call Out question before submitting. Incomplete: ${unansweredCount}`);
      setHighlightMissing(true);
      setStep(1);
      return;
    }

    if (photoMissingCount > 0) {
      setErr(`Please take all required photos before submitting. Missing: ${photoMissingCount}`);
      setHighlightMissingPhotos(true);
      setStep(1);
      return;
    }

    setDraftSubmitting(true);
    setDraftProgress(10);
    setDraftProgressText("Preparing call-out draft…");
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      let capturedSignature = signatureDataUrl || "";
      if (signatureTouched) {
        capturedSignature = captureSignatureNow() || capturedSignature;
      }

      setDraftProgress(35);
      setDraftProgressText("Collecting Call Out responses and evidence…");

      const value = buildDraftValue(capturedSignature);
      const name = buildDraftNameFromValue(value, Date.now());

      setDraftProgress(65);
      setDraftProgressText("Saving draft…");

      await saveDraftRecord(name, value);

      setDraftProgress(100);
      setDraftProgressText("Draft created successfully.");

      await new Promise((resolve) => window.setTimeout(resolve, 650));

      resetToStart(`Draft saved: ${name}`);
    } catch (e) {
      setDraftProgress(0);
      setDraftProgressText("");
      setStep(2);
      setErr(String(e?.message || "Failed to save draft."));
    } finally {
      setDraftSubmitting(false);
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

      await enqueueCallOutJobFromValue(rec.value, rec.name || "", rec.key || draftKey);
    } catch (e) {
      setErr(String(e?.message || "Failed to generate from draft."));
    }
  }

  async function removeJob(id) {
    if (!dbRef.current) return;
    await idbDelete(dbRef.current, "calloutJobs", id);
    await refreshJobs();
    emitJobsEvent();
  }

  async function retryJob(id) {
    if (!dbRef.current) return;
    const job = await idbGet(dbRef.current, "calloutJobs", id);
    if (!job) return;
    const updated = { ...job, status: "queued", error: "", lastUpdateAt: new Date().toISOString() };
    await idbPut(dbRef.current, "calloutJobs", updated);
    await refreshJobs();
    setInfo("Job re-queued.");
    emitJobsEvent();
  }

  function resetToStart(message = "") {
    setErr("");
    setInfo(message);
    setStep(0);
    setArea("");
    setCallOutStartAt("");
    setCallOutStartDate("");
    setCallOutStartTime("");
    setAreaSearch("");
    setAreaOpen(false);
    setQuestionIndex(0);
    setAnswers({
      system_defective: emptyCallOutAnswer("system_defective"),
      defect_resolved: emptyCallOutAnswer("defect_resolved")
    });
    setHighlightMissing(false);
    setHighlightMissingPhotos(false);

    setSignatureDataUrl("");
    setSignatureTouched(false);
    setDraftProgress(0);
    setDraftProgressText("");
  }

  if (!canAccess) {
    return <Alert variant="danger">Access denied.</Alert>;
  }

  return (
    <>
      <input
        ref={callOutCameraInputRef}
        type="file"
        accept="image/*"
        {...(isMobile ? { capture: "environment" } : {})}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files && e.target.files[0];
          const target = callOutPhotoTargetRef.current || {};
          if (file && target.qid) onCallOutPhotoSelected(target.qid, file);
          try { e.target.value = ""; } catch {}
        }}
      />
      <input
        ref={callOutPictureInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files && e.target.files[0];
          const target = callOutPhotoTargetRef.current || {};
          if (file && target.qid) onCallOutPhotoSelected(target.qid, file);
          try { e.target.value = ""; } catch {}
        }}
      />
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div>
          <h4 className="mb-0">Call Out</h4>
          <small className="text-muted">Pre-Start → Questionnaire → Review → Submit</small>
          {!online ? (
            <div className="mt-1">
              <Badge bg="warning" text="dark">Offline</Badge>
              <span className="text-muted small ms-2">Internet connection is required. Offline mode is temporarily disabled.</span>
            </div>
          ) : null}
        </div>

        <div className="d-flex align-items-center" style={{ gap: 8 }}>
          <Badge bg="info">{step === 3 ? "Saving Draft" : `Step ${step + 1} / 3`}</Badge>

          <CallOutButton
            variant="outline-secondary"
            onClick={loadAreaList}
            disabled={loadingLists || submitting || draftSubmitting}
          >
            {loadingLists ? (
              <>
                <Spinner className="me-2" /> Loading…
              </>
            ) : (
              "Refresh"
            )}
          </CallOutButton>

          <CallOutButton
            variant="outline-primary"
            onClick={refreshJobs}
            disabled={!dbReady || loadingJobs || draftSubmitting}
          >
            {loadingJobs ? (
              <>
                <Spinner className="me-2" /> Jobs…
              </>
            ) : (
              "Jobs"
            )}
          </CallOutButton>
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
      {dbReady && step !== 3 ? (
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
                      {j.summary?.area || "-"} • Call Out
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
                      <CallOutButton
                        variant="outline-primary"
                        onClick={() => downloadFile(j.result.url, j.result.fileName)}
                      >
                        Download
                      </CallOutButton>
                    ) : null}

                    {j.status === "error" ? (
                      <CallOutButton variant="outline-warning" onClick={() => retryJob(j.id)}>
                        Retry
                      </CallOutButton>
                    ) : null}

                    <CallOutButton variant="outline-danger" onClick={() => removeJob(j.id)}>
                      Remove
                    </CallOutButton>
                  </div>
                </div>
              ))
            )}
            <div className="text-muted small mt-2">
              Generation remains inactive until the Call Out report mapping is finalized.
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* ✅ DRAFTS (always visible, compact) */}
      {dbReady && step !== 3 ? (
        <Card border="light" className="shadow-sm mb-3">
          <Card.Header className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
            <div className="fw-bold">Saved Drafts</div>
            <div className="text-muted small">{drafts.length} draft(s)</div>
          </Card.Header>
          <Card.Body>
            {loadingDrafts ? (
              <div className="text-muted small">
                <Spinner className="me-2" /> Loading drafts…
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
                    <CallOutButton variant="primary" onClick={() => loadDraft(d.key)} disabled={submitting}>
                      Load
                    </CallOutButton>
                    <CallOutButton
                      variant="success"
                      onClick={() => generateFromDraft(d.key)}
                      disabled={true}
                      title="Generation will be enabled after the Call Out question/report mapping is defined."
                    >
                      Generate
                    </CallOutButton>
                    <CallOutButton variant="outline-secondary" onClick={() => renameDraft(d.key)} disabled={submitting}>
                      Rename
                    </CallOutButton>
                    <CallOutButton variant="outline-danger" onClick={() => deleteDraft(d.key)} disabled={submitting}>
                      Delete
                    </CallOutButton>
                  </div>
                </div>
              ))
            )}

            {drafts.length > 8 ? (
              <div className="text-muted small mt-2">Showing latest 8 drafts.</div>
            ) : null}

            <div className="text-muted small mt-2">
              Submit the completed Call Out questionnaire from Review to create a draft. Drafts remain browser-backed until the Call Out report mapping is finalized.
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 1: PRESTART */}
      {step === 0 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header>
            <h5 className="mb-0">Pre-Start</h5>
          </Card.Header>
          <Card.Body>
            <Row className="g-3">
              <Col md={12}>
                <Form.Group>
                  <Form.Label>Area <span className="text-danger">*</span></Form.Label>
                  <div className="text-muted small mb-2">
                    Choose an existing area or add it to the shared area list if it is not available.
                  </div>

                  <div ref={areaBoxRef} style={{ position: "relative" }}>
                    <Form.Control
                      ref={areaInputRef}
                      placeholder="Choose or search Area…"
                      value={areaOpen ? areaSearch : (area || "")}
                      disabled={loadingLists || addingArea}
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
                          e.preventDefault();
                          if (canAddArea) {
                            createGlobalAreaFromSearch();
                            return;
                          }
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
                          maxHeight: 320,
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
                              onMouseDown={(ev) => ev.preventDefault()}
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

                        {canAddArea ? (
                          <div
                            role="button"
                            tabIndex={0}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={createGlobalAreaFromSearch}
                            style={{
                              padding: "10px 12px",
                              cursor: addingArea ? "wait" : "pointer",
                              borderTop: "1px solid rgba(0,0,0,0.08)",
                              background: "#f8f9fa"
                            }}
                          >
                            <div className="fw-bold" style={{ fontSize: 14 }}>
                              {addingArea ? "Adding…" : `+ Add “${String(areaSearch || "").replace(/\s+/g, " ").trim()}”`}
                            </div>
                            <div className="text-muted small">
                              Adds this area to the same list used by Servicing and Call Out.
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Form.Group>
              </Col>

            </Row>
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 2: QUESTIONNAIRE */}
      {step === 1 ? (() => {
        const q = questionRows[questionIndex] || questionRows[0];
        const a = { ...emptyCallOutAnswer(q.id), ...(answers?.[q.id] || {}) };
        const answer = String(a.answer || "").trim().toUpperCase();
        const photos = normalizeCallOutPhotos(a);
        const requirements = normalizeRequirements(a);
        const complete = callOutResponseComplete(q.id, a);
        const isFirstQuestion = q.id === "system_defective";

        return (
          <>
            <Card border="light" className="shadow-sm mb-3">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 12 }}>
                  <div>
                    <h5 className="mb-1">Questionnaire</h5>
                    <div className="text-muted small">{area}</div>
                  </div>
                  <div className="text-end">
                    <div className="fw-bold">Question {questionIndex + 1} of {systemDefectiveAnswer === "YES" ? 2 : 1}</div>
                    <div className="text-muted small">{completedCount} completed</div>
                  </div>
                </div>
              </Card.Body>
            </Card>

            <Card className="mb-3 shadow-sm" style={(highlightMissing && !complete) ? { borderColor: "#dc3545", borderWidth: 1 } : undefined}>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 10 }}>
                  <div style={{ flex: "1 1 520px" }}>
                    <div className="text-muted small mb-1">Question {questionIndex + 1}</div>
                    <div className="fw-bold" style={{ fontSize: 18 }}>{q.question}</div>
                  </div>
                  {complete ? <Badge bg="success">Complete</Badge> : <Badge bg="secondary">Pending</Badge>}
                </div>

                <div className="mt-3">
                  <div className="fw-bold mb-2">Response</div>
                  <div className="d-flex flex-wrap" style={{ gap: 12 }}>
                    <ChecklistOptionPill
                      active={answer === "YES"}
                      tone={isFirstQuestion ? "danger" : "success"}
                      icon="✓"
                      onClick={() => selectCallOutAnswer(q.id, "YES")}
                    >
                      Yes
                    </ChecklistOptionPill>
                    <ChecklistOptionPill
                      active={answer === "NO"}
                      tone={isFirstQuestion ? "success" : "danger"}
                      icon="✕"
                      onClick={() => selectCallOutAnswer(q.id, "NO")}
                    >
                      No
                    </ChecklistOptionPill>
                  </div>
                </div>

                {answer === "YES" ? (
                  <div className="mt-3 p-3" style={{ border: "1px solid #dee2e6", borderRadius: 10, background: "#f8f9fa" }}>
                    <div className="fw-bold mb-2">{isFirstQuestion ? "Defect evidence" : "Repair evidence"}</div>
                    <div className="text-muted small mb-3">
                      {isFirstQuestion
                        ? "Take at least one picture, add a comment to every picture, and describe the defect."
                        : "Take at least one picture, add a comment to every picture, and describe what was done to repair the defect."}
                    </div>

                    <Form.Group className="mb-3">
                      <Form.Label>
                        {isFirstQuestion ? "Defect description" : "Repair description"} <span className="text-danger">Required</span>
                      </Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        placeholder={isFirstQuestion ? "Describe the defect" : "Describe what was done to repair the defect"}
                        value={a.comment || ""}
                        onChange={(e) => updateCallOutAnswer(q.id, { comment: e.target.value })}
                      />
                    </Form.Group>

                    <div className="d-flex flex-wrap align-items-center mb-3" style={{ gap: 8 }}>
                      <CallOutButton type="button" variant="primary" onClick={() => openCallOutCamera(q.id)}>
                        Open camera
                      </CallOutButton>
                      {isFirstQuestion ? (
                        <CallOutButton type="button" variant="outline-primary" onClick={() => openCallOutPicturePicker(q.id)}>
                          Add picture
                        </CallOutButton>
                      ) : null}
                      <Badge bg={photos.length ? "success" : "secondary"}>
                        {photos.length} picture{photos.length === 1 ? "" : "s"}
                      </Badge>
                    </div>

                    {photos.length ? (
                      <Row>
                        {photos.map((photo, photoIndex) => (
                          <Col md={6} lg={4} key={`${q.id}-photo-${photoIndex}`} className="mb-3">
                            <div className="p-2 bg-white" style={{ border: "1px solid #dee2e6", borderRadius: 8 }}>
                              {photo.dataUrl ? (
                                <img
                                  src={photo.dataUrl}
                                  alt={`${isFirstQuestion ? "Defect" : "Repair"} evidence ${photoIndex + 1}`}
                                  style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 6 }}
                                />
                              ) : null}
                              <div className="d-flex justify-content-between align-items-center mt-2" style={{ gap: 8 }}>
                                <span className="small text-muted">Picture {photoIndex + 1}</span>
                                <CallOutButton type="button" variant="outline-danger" onClick={() => removeCallOutPhoto(q.id, photoIndex)}>
                                  Remove
                                </CallOutButton>
                              </div>
                              <Form.Group className="mt-2">
                                <Form.Label className="small fw-bold mb-1">
                                  Picture comment <span className="text-danger">Required</span>
                                </Form.Label>
                                <Form.Control
                                  as="textarea"
                                  rows={2}
                                  placeholder="Describe what this picture shows"
                                  value={photo.comment || ""}
                                  onChange={(e) => updateCallOutPhotoComment(q.id, photoIndex, e.target.value)}
                                />
                              </Form.Group>
                            </div>
                          </Col>
                        ))}
                      </Row>
                    ) : null}
                  </div>
                ) : null}

                {!isFirstQuestion && answer === "NO" ? (
                  <div className="mt-3 p-3" style={{ border: "1px solid #f1aeb5", borderRadius: 10, background: "#fff8f8" }}>
                    <div className="fw-bold mb-1">Repair requirements</div>
                    <div className="text-muted small mb-3">Describe what is required to repair the defect. Add more requirements where needed.</div>

                    {(requirements.length ? requirements : [""]).map((requirement, requirementIndex) => (
                      <div key={`requirement-${requirementIndex}`} className="mb-3">
                        <Form.Label>
                          Requirement {requirementIndex + 1} <span className="text-danger">Required</span>
                        </Form.Label>
                        <div className="d-flex align-items-start" style={{ gap: 8 }}>
                          <Form.Control
                            id={`callout-requirement-${requirementIndex}`}
                            as="textarea"
                            rows={3}
                            placeholder="Describe what is required to repair the defect"
                            value={requirement}
                            onChange={(e) => updateRequirement(requirementIndex, e.target.value)}
                          />
                          {requirements.length > 1 ? (
                            <CallOutButton type="button" variant="outline-danger" onClick={() => removeRequirement(requirementIndex)}>
                              Remove
                            </CallOutButton>
                          ) : null}
                        </div>
                      </div>
                    ))}

                    <CallOutButton
                      type="button"
                      variant="outline-secondary"
                      onClick={addRequirement}
                      disabled={(requirements.length ? requirements : [""]).some((value) => !String(value || "").trim())}
                    >
                      Add another requirement
                    </CallOutButton>
                  </div>
                ) : null}

                {highlightMissing && !complete ? (
                  <div className="text-danger small mt-3">
                    {!answer
                      ? "Select Yes or No."
                      : answer === "YES"
                        ? `At least one picture, a comment for every picture, and a ${isFirstQuestion ? "defect" : "repair"} description are required.`
                        : "Enter every repair requirement before continuing."}
                  </div>
                ) : null}
              </Card.Body>
            </Card>
          </>
        );
      })() : null}

      {/* STEP 3: REVIEW */}
      {step === 2 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Review</h5>
            <small className="text-muted">Incomplete: {unansweredCount} • Defect reported: {defectsFoundCount ? "Yes" : "No"}</small>
          </Card.Header>
          <Card.Body>
            <Alert variant="info">Review the Call Out responses, add the technician signature if required, then press <strong>Submit</strong>. The draft will be created immediately and you will return to Pre-Start.</Alert>

            <div className="mb-2"><strong>Technician:</strong> {authUser?.name || authUser?.email || "-"}</div>
            <div className="mb-2"><strong>Area:</strong> {area}</div>
            <div className="mb-2"><strong>Call Out Start Date:</strong> {callOutStartDate || "-"}</div>
            <div className="mb-3"><strong>Call Out Start Time:</strong> {callOutStartTime ? callOutStartTime.slice(0, 5) : "-"}</div>

            <hr />

            <Card className="mb-3">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 8 }}>
                  <div className="fw-bold">1. Is the system defective?</div>
                  <Badge bg={systemDefectiveAnswer === "YES" ? "danger" : "success"}>{systemDefectiveAnswer || "Pending"}</Badge>
                </div>
                {systemDefectiveAnswer === "YES" ? (
                  <div className="mt-2">
                    <div className="small"><strong>Defect:</strong> {String(answers?.system_defective?.comment || "").trim() || "Missing"}</div>
                    <div className="small fw-bold mt-2">Pictures:</div>
                    {normalizeCallOutPhotos(answers?.system_defective || {}).map((photo, index) => (
                      <div key={`review-defect-photo-${index}`} className="small ms-2">
                        Picture {index + 1}: {photo.comment || "Missing comment"}
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card.Body>
            </Card>

            {systemDefectiveAnswer === "YES" ? (
              <Card className="mb-3">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 8 }}>
                    <div className="fw-bold">2. Could the defect be resolved?</div>
                    <Badge bg={String(answers?.defect_resolved?.answer || "").toUpperCase() === "YES" ? "success" : "danger"}>
                      {String(answers?.defect_resolved?.answer || "").toUpperCase() || "Pending"}
                    </Badge>
                  </div>

                  {String(answers?.defect_resolved?.answer || "").toUpperCase() === "YES" ? (
                    <div className="mt-2">
                      <div className="small"><strong>Repair completed:</strong> {String(answers?.defect_resolved?.comment || "").trim() || "Missing"}</div>
                      <div className="small fw-bold mt-2">Pictures:</div>
                      {normalizeCallOutPhotos(answers?.defect_resolved || {}).map((photo, index) => (
                        <div key={`review-repair-photo-${index}`} className="small ms-2">
                          Picture {index + 1}: {photo.comment || "Missing comment"}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2">
                      <div className="small fw-bold mb-1">Repair requirements:</div>
                      <ol className="mb-0 ps-3">
                        {normalizeRequirements(answers?.defect_resolved || {}).filter((value) => value.trim()).map((value, index) => (
                          <li key={`review-requirement-${index}`} className="small">{value}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </Card.Body>
              </Card>
            ) : null}

            <hr />

            <Card className="mb-0">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
                  <div>
                    <div className="fw-bold">Signature</div>
                    <div className="text-muted small">Draw below (touch or mouse). The signature is saved with the draft when you press Submit.</div>
                  </div>

                  <div className="d-flex align-items-center" style={{ gap: 8 }}>
                    {signatureDataUrl ? <Badge bg="success">Captured</Badge> : <Badge bg="secondary">Not captured</Badge>}
                    <CallOutButton variant="outline-secondary" onClick={clearSignature}>Clear</CallOutButton>
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
                  Signature will be captured as PNG when you press Submit.
                </div>
              </Card.Body>
            </Card>
          </Card.Body>
        </Card>
      ) : null}

      {/* STEP 4: DRAFT CREATION PROGRESS */}
      {step === 3 ? (
        <Card border="light" className="shadow-sm">
          <Card.Header>
            <h5 className="mb-0">Creating Draft</h5>
          </Card.Header>
          <Card.Body>
            <div className="mb-3">
              <ProgressBar
                now={draftProgress}
                label={`${draftProgress}%`}
                animated={draftProgress > 0 && draftProgress < 100}
                variant={draftProgress === 100 ? "success" : "primary"}
                style={{ height: "20px" }}
              />
            </div>

            <div className="d-flex align-items-center" style={{ gap: 10 }}>
              {draftProgress < 100 ? <Spinner /> : <Badge bg="success">Saved</Badge>}
              <div className="fw-bold">{draftProgressText || "Preparing draft…"}</div>
            </div>

            <div className="text-muted small mt-2">
              Please wait. You will return to the Call Out start screen automatically once the draft has been saved.
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* NAV BUTTONS */}
      {step < 3 ? (
        <div className="d-flex justify-content-between mt-3">
          <CallOutButton variant="secondary" onClick={back} disabled={step === 0 || draftSubmitting}>
            Back
          </CallOutButton>

          {step === 2 ? (
            <CallOutButton
              variant="success"
              onClick={submitReviewAndSaveDraft}
              disabled={draftSubmitting || unansweredCount > 0 || photoMissingCount > 0}
            >
              {draftSubmitting ? (
                <>
                  <Spinner className="me-2" /> Submitting…
                </>
              ) : (
                "Submit"
              )}
            </CallOutButton>
          ) : (
            <CallOutButton variant="primary" onClick={next} disabled={draftSubmitting}>
              Next
            </CallOutButton>
          )}
        </div>
      ) : null}
    </>
  );
}
