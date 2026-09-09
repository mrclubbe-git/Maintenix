import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Row, Col, Button, Form, Alert, Badge } from "@themesberg/react-bootstrap";

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "").toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(ua);
}

function makePhotoId() {
  return `photo_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeJobId() {
  return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeReportId() {
  return `co_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeDraftKey() {
  return `callout_draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ---- IndexedDB helpers (mirrors Servicing approach) ----
const DB_NAME = "maintenix";
const STORE_CACHE = "calloutCache";
const STORE_JOBS = "calloutJobs";

// Job schema protection (keep in sync with runner)
const JOB_SCHEMA_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available in this environment."));
      return;
    }

    // IMPORTANT: do NOT force a version here (prevents version mismatch with other pages)
    const req = indexedDB.open(DB_NAME);

    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;

      // NOTE: We only create the callout stores here.
      // Servicing stores are created elsewhere in your app (or may already exist).
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        const s = db.createObjectStore(STORE_JOBS, { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB."));
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error("IndexedDB put failed"));
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
  });
}

function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("IndexedDB getAll failed"));
  });
}

function sanitizePhotoForStorage(p) {
  return {
    id: p.id,
    name: p.name || "photo.jpg",
    dataUrl: p.dataUrl || "",
    description: p.description || ""
    // IMPORTANT: do not store the File object in IndexedDB drafts/jobs
  };
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

function isActiveJobStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "queued" || s === "retry" || s === "submitting" || s === "server_pending" || s === "polling" || s === "running";
}

function badgeForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "done") return <Badge bg="success">done</Badge>;
  if (s === "error") return <Badge bg="danger">error</Badge>;
  if (s === "stopped") return <Badge bg="secondary">stopped</Badge>;
  if (s === "queued") return <Badge bg="secondary">queued</Badge>;
  if (s === "submitting") return <Badge bg="info">submitting</Badge>;
  if (s === "server_pending") return (
    <Badge bg="warning" text="dark">
      server_pending
    </Badge>
  );
  if (s === "polling") return <Badge bg="info">polling</Badge>;
  if (s === "running") return <Badge bg="primary">running</Badge>;
  if (s === "retry") return (
    <Badge bg="warning" text="dark">
      retry
    </Badge>
  );
  return (
    <Badge bg="light" text="dark">
      {s || "unknown"}
    </Badge>
  );
}

function migrateCalloutJob(job) {
  const j = job && typeof job === "object" ? { ...job } : null;
  if (!j) return { migrated: null, changed: false };

  let changed = false;

  if (!j.schemaVersion || Number(j.schemaVersion) !== JOB_SCHEMA_VERSION) {
    j.schemaVersion = JOB_SCHEMA_VERSION;
    changed = true;
  }

  if (!j.type) {
    j.type = "callout";
    changed = true;
  }

  if (!j.createdAt) {
    j.createdAt = new Date().toISOString();
    changed = true;
  }

  if (!j.status) {
    j.status = "queued";
    changed = true;
  }

  if (typeof j.retries !== "number") {
    j.retries = 0;
    changed = true;
  }

  if (typeof j.error !== "string") {
    j.error = "";
    changed = true;
  }

  if (!j.payload || typeof j.payload !== "object") {
    j.payload = {};
    changed = true;
  }

  if (!j.reportId) {
    const rid = String(j.payload?.reportId || "").trim();
    j.reportId = rid || makeReportId();
    changed = true;
  }

  if (!j.payload.reportId) {
    j.payload.reportId = j.reportId;
    changed = true;
  }

  if (!j.lastUpdateAt) {
    j.lastUpdateAt = j.createdAt;
    changed = true;
  }

  return { migrated: j, changed };
}

function migrateCalloutDraft(rec) {
  const d = rec && typeof rec === "object" ? { ...rec } : null;
  if (!d) return { migrated: null, changed: false };

  let changed = false;

  if (!d.schemaVersion || Number(d.schemaVersion) !== JOB_SCHEMA_VERSION) {
    d.schemaVersion = JOB_SCHEMA_VERSION;
    changed = true;
  }

  if (!d.type) {
    d.type = "calloutDraft";
    changed = true;
  }

  if (!d.createdAt) {
    d.createdAt = new Date().toISOString();
    changed = true;
  }

  if (!d.updatedAt) {
    d.updatedAt = d.createdAt;
    changed = true;
  }

  if (!d.value || typeof d.value !== "object") {
    d.value = {};
    changed = true;
  }

  if (typeof d.name !== "string") {
    d.name = "";
    changed = true;
  }

  return { migrated: d, changed };
}

export default function CallOut() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, []);

  const isMobile = useMemo(() => isMobileDevice(), []);

  // ---- Form fields ----
  const [area, setArea] = useState("");
  const [systemType, setSystemType] = useState("");

  const [timeCallLogged, setTimeCallLogged] = useState(""); // datetime-local
  const [callLoggedByName, setCallLoggedByName] = useState("");
  const [callLoggedByRole, setCallLoggedByRole] = useState("");

  const [clientDefectDesc, setClientDefectDesc] = useState("");

  const [timeArrival, setTimeArrival] = useState(""); // datetime-local
  const [responderDefectDesc, setResponderDefectDesc] = useState("");

  const [couldRectify, setCouldRectify] = useState(""); // YES/NO
  const [actionTaken, setActionTaken] = useState("");
  const [materialsRequired, setMaterialsRequired] = useState("");

  const [timeDeparture, setTimeDeparture] = useState(""); // datetime-local

  const [jobcardCreated, setJobcardCreated] = useState(""); // YES/NO
  const [jobcardNumber, setJobcardNumber] = useState("");
  const [noJobcardReason, setNoJobcardReason] = useState("");

  // ---- Photos ----
  const photoInputRef = useRef(null);
  const [photos, setPhotos] = useState([]); // {id, file, dataUrl, description, name}

  // ---- UI feedback ----
  const [banner, setBanner] = useState({ show: false, variant: "info", text: "" });
  const [busy, setBusy] = useState(false);

  // ---- Jobs / Drafts widgets ----
  const [jobs, setJobs] = useState([]);
  const [drafts, setDrafts] = useState([]);

  // Load jobs + drafts on mount, and refresh periodically + on events
  useEffect(() => {
    let cancelled = false;

    const loadJobs = async () => {
      try {
        const db = await openDb();
        const allJobs = await idbGetAll(db, STORE_JOBS);
        if (cancelled) return;

        const migratedJobs = [];
        for (const raw of allJobs || []) {
          const { migrated, changed } = migrateCalloutJob(raw);
          if (!migrated) continue;
          migratedJobs.push(migrated);
          if (changed) {
            try {
              await idbPut(db, STORE_JOBS, migrated);
            } catch {
              // ignore
            }
          }
        }

        const sorted = migratedJobs
          .slice()
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

        setJobs(sorted);
      } catch {
        // ignore
      }
    };

    const loadDrafts = async () => {
      try {
        const db = await openDb();
        const all = await idbGetAll(db, STORE_CACHE);
        if (cancelled) return;

        const migratedDrafts = [];
        for (const raw of all || []) {
          if (!raw || typeof raw.key !== "string" || !raw.key.startsWith("callout_draft_")) continue;

          const { migrated, changed } = migrateCalloutDraft(raw);
          if (!migrated) continue;
          migratedDrafts.push(migrated);

          if (changed) {
            try {
              await idbPut(db, STORE_CACHE, migrated);
            } catch {
              // ignore
            }
          }
        }

        const onlyDrafts = migratedDrafts.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
        setDrafts(onlyDrafts);
      } catch {
        // ignore
      }
    };

    const refreshAll = async () => {
      await loadJobs();
      await loadDrafts();
    };

    refreshAll();

    const onJobsEvent = () => refreshAll();
    window.addEventListener("maintenix:callout-jobs", onJobsEvent);

    // small poll so UI reflects background runner updates even without events
    const t = setInterval(refreshAll, 4000);

    return () => {
      cancelled = true;
      window.removeEventListener("maintenix:callout-jobs", onJobsEvent);
      clearInterval(t);
    };
  }, []);

  const triggerPhotoPicker = () => {
    if (photoInputRef.current && typeof photoInputRef.current.click === "function") {
      photoInputRef.current.click();
    }
  };

  const onPhotosSelected = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const readers = files.map(
      (f) =>
        new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () =>
            resolve({
              id: makePhotoId(),
              file: f,
              name: f?.name || "photo.jpg",
              dataUrl: String(r.result || ""),
              description: ""
            });
          r.readAsDataURL(f);
        })
    );

    const newOnes = await Promise.all(readers);
    setPhotos((prev) => [...(prev || []), ...newOnes]);

    // allow re-selecting the same file
    try {
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch {}
  };

  const updatePhoto = (id, patch) => {
    setPhotos((prev) => (prev || []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePhoto = (id) => {
    setPhotos((prev) => (prev || []).filter((p) => p.id !== id));
  };

  function resetForm() {
    setArea("");
    setSystemType("");
    setTimeCallLogged("");
    setCallLoggedByName("");
    setCallLoggedByRole("");
    setClientDefectDesc("");
    setTimeArrival("");
    setResponderDefectDesc("");
    setCouldRectify("");
    setActionTaken("");
    setMaterialsRequired("");
    setTimeDeparture("");
    setJobcardCreated("");
    setJobcardNumber("");
    setNoJobcardReason("");
    setPhotos([]);
  }

  function buildPayload() {
    // Keep payload aligned with your UI fields
    return {
      area: area || "",
      systemType: systemType || "",

      timeCallLogged: timeCallLogged || "",
      callLoggedByName: callLoggedByName || "",
      callLoggedByRole: callLoggedByRole || "",

      clientDefectDesc: clientDefectDesc || "",

      timeArrival: timeArrival || "",
      responderDefectDesc: responderDefectDesc || "",

      couldRectify: couldRectify || "",
      actionTaken: couldRectify === "YES" ? (actionTaken || "") : "",
      materialsRequired: couldRectify === "NO" ? (materialsRequired || "") : "",

      timeDeparture: timeDeparture || "",

      jobcardCreated: jobcardCreated || "",
      jobcardNumber: jobcardCreated === "YES" ? (jobcardNumber || "") : "",
      noJobcardReason: jobcardCreated === "NO" ? (noJobcardReason || "") : "",

      photos: (photos || []).map(sanitizePhotoForStorage)
    };
  }

  function loadPayloadIntoForm(v) {
    const payload = v || {};
    setArea(payload.area || "");
    setSystemType(payload.systemType || "");

    setTimeCallLogged(payload.timeCallLogged || "");
    setCallLoggedByName(payload.callLoggedByName || "");
    setCallLoggedByRole(payload.callLoggedByRole || "");

    setClientDefectDesc(payload.clientDefectDesc || "");

    setTimeArrival(payload.timeArrival || "");
    setResponderDefectDesc(payload.responderDefectDesc || "");

    setCouldRectify(payload.couldRectify || "");
    setActionTaken(payload.actionTaken || "");
    setMaterialsRequired(payload.materialsRequired || "");

    setTimeDeparture(payload.timeDeparture || "");

    setJobcardCreated(payload.jobcardCreated || "");
    setJobcardNumber(payload.jobcardNumber || "");
    setNoJobcardReason(payload.noJobcardReason || "");

    setPhotos(Array.isArray(payload.photos) ? payload.photos.map((p) => ({ ...p, file: null })) : []);
  }

  function validateForQueue() {
    // Light validation + enforce conditional logic
    if (!area.trim()) return "Area is required.";
    if (!systemType.trim()) return "System type is required.";
    if (!timeCallLogged) return "Time of call logged is required.";
    if (!clientDefectDesc.trim()) return "Client description of the defect is required.";
    if (!timeArrival) return "Time of responder arrival is required.";
    if (!couldRectify) return "Please select whether the defect could be rectified.";
    if (couldRectify === "YES" && !actionTaken.trim()) return "Action taken is required when rectified = Yes.";
    if (couldRectify === "NO" && !materialsRequired.trim()) return "Materials required is required when rectified = No.";
    if (!timeDeparture) return "Time of responder departure is required.";
    if (!jobcardCreated) return "Please select whether a jobcard was created.";
    if (jobcardCreated === "YES" && !jobcardNumber.trim()) return "Jobcard number is required when jobcard created = Yes.";
    if (jobcardCreated === "NO" && !noJobcardReason.trim()) return "Reason is required when jobcard created = No.";
    return "";
  }

  const saveDraftRecord = async (nameOverride) => {
    const db = await openDb();
    const payload = buildPayload();

    const key = makeDraftKey();
    const name =
      String(nameOverride || "").trim() ||
      String(area || "").trim() ||
      `Draft ${new Date().toLocaleString()}`;

    await idbPut(db, STORE_CACHE, {
      key,
      type: "calloutDraft",
      schemaVersion: JOB_SCHEMA_VERSION,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      value: payload
    });

    // refresh drafts widget
    try {
      const all = await idbGetAll(db, STORE_CACHE);

      const migratedDrafts = [];
      for (const raw of all || []) {
        if (!raw || typeof raw.key !== "string" || !raw.key.startsWith("callout_draft_")) continue;

        const { migrated, changed } = migrateCalloutDraft(raw);
        if (!migrated) continue;
        migratedDrafts.push(migrated);

        if (changed) {
          try {
            await idbPut(db, STORE_CACHE, migrated);
          } catch {
            // ignore
          }
        }
      }

      const onlyDrafts = migratedDrafts.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      setDrafts(onlyDrafts);
    } catch {}

    return key;
  };

  const saveOfflineDraft = async () => {
    setBusy(true);
    try {
      await saveDraftRecord("");
      setBanner({ show: true, variant: "success", text: "Draft saved." });
    } catch (e) {
      setBanner({
        show: true,
        variant: "danger",
        text: `Failed to save draft: ${e?.message || "Unknown error"}`
      });
    } finally {
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const generateWithAutoDraft = async () => {
    // Requirement: Generate should auto-save draft, then generate
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Save a draft first (even if validation fails)
    try {
      setBusy(true);
      await saveDraftRecord(area);
    } catch (e) {
      // Show warning but continue to validate + queue
      setBanner({
        show: true,
        variant: "warning",
        text: `Could not auto-save draft: ${e?.message || "Unknown error"}`
      });
    } finally {
      setBusy(false);
    }

    // Now queue generation (uses validation)
    await queueGenerate();
  };

  const loadDraft = async (draftKey) => {
    setBusy(true);
    try {
      const db = await openDb();
      const d = await idbGet(db, STORE_CACHE, draftKey);
      if (!d || !d.value) {
        setBanner({ show: true, variant: "warning", text: "Draft not found." });
        return;
      }

      loadPayloadIntoForm(d.value);
      setBanner({ show: true, variant: "success", text: `Draft loaded: ${d.name || draftKey}` });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setBanner({ show: true, variant: "danger", text: `Failed to load draft: ${e?.message || "Unknown error"}` });
    } finally {
      setBusy(false);
    }
  };

  const renameDraft = async (draftKey) => {
    const newName = window.prompt("Draft name:", "");
    if (newName === null) return; // cancelled
    const name = String(newName || "").trim();
    if (!name) return;

    setBusy(true);
    try {
      const db = await openDb();
      const d = await idbGet(db, STORE_CACHE, draftKey);
      if (!d) {
        setBanner({ show: true, variant: "warning", text: "Draft not found." });
        return;
      }

      await idbPut(db, STORE_CACHE, {
        ...d,
        schemaVersion: JOB_SCHEMA_VERSION,
        name,
        updatedAt: new Date().toISOString()
      });

      const all = await idbGetAll(db, STORE_CACHE);

      const migratedDrafts = [];
      for (const raw of all || []) {
        if (!raw || typeof raw.key !== "string" || !raw.key.startsWith("callout_draft_")) continue;

        const { migrated, changed } = migrateCalloutDraft(raw);
        if (!migrated) continue;
        migratedDrafts.push(migrated);

        if (changed) {
          try {
            await idbPut(db, STORE_CACHE, migrated);
          } catch {
            // ignore
          }
        }
      }

      const onlyDrafts = migratedDrafts.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      setDrafts(onlyDrafts);
    } catch (e) {
      setBanner({ show: true, variant: "danger", text: `Failed to rename draft: ${e?.message || "Unknown error"}` });
    } finally {
      setBusy(false);
    }
  };

  const deleteDraft = async (draftKey) => {
    const ok = window.confirm("Delete this draft?");
    if (!ok) return;

    setBusy(true);
    try {
      const db = await openDb();
      await idbDelete(db, STORE_CACHE, draftKey);

      const all = await idbGetAll(db, STORE_CACHE);

      const migratedDrafts = [];
      for (const raw of all || []) {
        if (!raw || typeof raw.key !== "string" || !raw.key.startsWith("callout_draft_")) continue;

        const { migrated, changed } = migrateCalloutDraft(raw);
        if (!migrated) continue;
        migratedDrafts.push(migrated);

        if (changed) {
          try {
            await idbPut(db, STORE_CACHE, migrated);
          } catch {
            // ignore
          }
        }
      }

      const onlyDrafts = migratedDrafts.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      setDrafts(onlyDrafts);
    } catch (e) {
      setBanner({ show: true, variant: "danger", text: `Failed to delete draft: ${e?.message || "Unknown error"}` });
    } finally {
      setBusy(false);
    }
  };

  const clearDoneJobs = async () => {
    const doneCount = (jobs || []).filter((j) => String(j?.status || "").toLowerCase() === "done").length;
    if (!doneCount) {
      setBanner({ show: true, variant: "info", text: "No done jobs to clear." });
      return;
    }

    const ok = window.confirm(`Clear ${doneCount} done job(s) from the queue list?`);
    if (!ok) return;

    setBusy(true);
    try {
      const db = await openDb();
      const allJobs = await idbGetAll(db, STORE_JOBS);

      const doneJobs = (allJobs || []).filter((j) => String(j?.status || "").toLowerCase() === "done");
      for (const j of doneJobs) {
        await idbDelete(db, STORE_JOBS, j.id);
      }

      const remaining = (allJobs || [])
        .filter((j) => String(j?.status || "").toLowerCase() !== "done")
        .slice();

      const migratedRemaining = [];
      for (const raw of remaining || []) {
        const { migrated, changed } = migrateCalloutJob(raw);
        if (!migrated) continue;
        migratedRemaining.push(migrated);
        if (changed) {
          try {
            await idbPut(db, STORE_JOBS, migrated);
          } catch {
            // ignore
          }
        }
      }

      const sorted = migratedRemaining.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      setJobs(sorted);

      try {
        window.dispatchEvent(new CustomEvent("maintenix:callout-jobs"));
      } catch {}

      setBanner({ show: true, variant: "success", text: `Cleared ${doneJobs.length} done job(s).` });
    } catch (e) {
      setBanner({ show: true, variant: "danger", text: `Failed to clear done jobs: ${e?.message || "Unknown error"}` });
    } finally {
      setBusy(false);
    }
  };

  const stopJob = async (jobId) => {
    setBusy(true);
    try {
      const db = await openDb();
      const j = await idbGet(db, STORE_JOBS, jobId);
      if (!j) {
        setBanner({ show: true, variant: "warning", text: "Job not found." });
        return;
      }

      const { migrated } = migrateCalloutJob(j);
      if (!migrated) {
        setBanner({ show: true, variant: "warning", text: "Job not found." });
        return;
      }

      const updated = {
        ...migrated,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
        lastUpdateAt: new Date().toISOString()
      };

      await idbPut(db, STORE_JOBS, updated);

      setJobs((prev) => (prev || []).map((x) => (x && x.id === jobId ? updated : x)));

      try {
        window.dispatchEvent(new CustomEvent("maintenix:callout-jobs"));
      } catch {}
    } catch (e) {
      setBanner({ show: true, variant: "danger", text: `Failed to stop job: ${e?.message || "Unknown error"}` });
    } finally {
      setBusy(false);
    }
  };

  const removeJob = async (jobId) => {
    setBusy(true);
    try {
      const db = await openDb();
      await idbDelete(db, STORE_JOBS, jobId);

      setJobs((prev) => (prev || []).filter((x) => x && x.id !== jobId));

      try {
        window.dispatchEvent(new CustomEvent("maintenix:callout-jobs"));
      } catch {}
    } catch (e) {
      setBanner({ show: true, variant: "danger", text: `Failed to remove job: ${e?.message || "Unknown error"}` });
    } finally {
      setBusy(false);
    }
  };

  const queueGenerate = async () => {
    // Requirement: navigate to top when queue button is pressed (even if validation fails)
    window.scrollTo({ top: 0, behavior: "smooth" });

    const err = validateForQueue();
    if (err) {
      setBanner({ show: true, variant: "warning", text: err });
      return;
    }

    setBusy(true);
    try {
      const db = await openDb();
      const payload = buildPayload();

      const reportId = makeReportId();
      const jobId = makeJobId();

      const job = {
        id: jobId,
        type: "callout",
        schemaVersion: JOB_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        status: "queued",
        reportId,
        payload: { ...payload, reportId },
        retries: 0,
        error: "",
        lastUpdateAt: new Date().toISOString()
      };

      await idbPut(db, STORE_JOBS, job);

      // Wake background runner
      try {
        window.dispatchEvent(new CustomEvent("maintenix:callout-jobs"));
      } catch {}

      setBanner({
        show: true,
        variant: "success",
        text: online ? `Queued. Report ID: ${reportId}` : `Queued (offline). Will sync when online. Report ID: ${reportId}`
      });

      // refresh jobs widget quickly
      try {
        const allJobs = await idbGetAll(db, STORE_JOBS);

        const migratedJobs = [];
        for (const raw of allJobs || []) {
          const { migrated, changed } = migrateCalloutJob(raw);
          if (!migrated) continue;
          migratedJobs.push(migrated);
          if (changed) {
            try {
              await idbPut(db, STORE_JOBS, migrated);
            } catch {
              // ignore
            }
          }
        }

        const sorted = migratedJobs
          .slice()
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        setJobs(sorted);
      } catch {}
    } catch (e) {
      setBanner({
        show: true,
        variant: "danger",
        text: `Failed to queue generation job: ${e?.message || "Unknown error"}`
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div>
          <h4 className="mb-0">Call Out</h4>

          {!online ? (
            <div className="mt-1">
              <Badge bg="warning" text="dark">
                Offline mode
              </Badge>
              <span className="text-muted small ms-2">You can capture the form offline and queue for sync.</span>
            </div>
          ) : null}
        </div>

        <div className="d-flex align-items-center" style={{ gap: 8, flexWrap: "wrap" }}>
          {online ? <Badge bg="success">Online</Badge> : <Badge bg="secondary">Offline</Badge>}
        </div>
      </div>

      {banner?.show ? (
        <Alert
          variant={banner.variant || "info"}
          className="mb-3"
          onClose={() => setBanner((b) => ({ ...(b || {}), show: false }))}
          dismissible
        >
          {banner.text}
        </Alert>
      ) : null}

      {/* Jobs + Drafts widgets */}
      <Row className="g-3 mb-3">
        <Col xs={12} lg={6}>
          <Card border="light" className="shadow-sm h-100">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
              <div>
                <h5 className="mb-0">Queued Jobs</h5>
                <small className="text-muted">Latest call-out report jobs</small>
              </div>

              {/* Right-side: total + clear done */}
              <div className="d-flex flex-column align-items-end" style={{ gap: 6 }}>
                <Badge bg="info">{jobs.length}</Badge>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={clearDoneJobs}
                  disabled={busy || !jobs.some((j) => String(j?.status || "").toLowerCase() === "done")}
                >
                  Clear done
                </Button>
              </div>
            </Card.Header>

            <Card.Body>
              {!jobs.length ? (
                <div className="text-muted small">No jobs yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {jobs.slice(0, 8).map((j) => {
                    const s = String(j?.status || "").toLowerCase();
                    const showStop = isActiveJobStatus(s) && s !== "done" && s !== "error" && s !== "stopped";
                    const showRemove = s === "stopped";

                    return (
                      <div
                        key={j.id}
                        style={{
                          border: "1px solid #e9ecef",
                          borderRadius: 10,
                          padding: 10
                        }}
                      >
                        <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 10 }}>
                          <div style={{ minWidth: 200 }}>
                            <div className="fw-bold">{j.reportId}</div>
                            <div className="text-muted small">Created: {formatDateTimeLocal(j.createdAt)}</div>
                          </div>

                          <div className="d-flex align-items-center" style={{ gap: 10, flexWrap: "wrap" }}>
                            <div>{badgeForStatus(j.status)}</div>

                            {showStop ? (
                              <Button size="sm" variant="outline-warning" onClick={() => stopJob(j.id)} disabled={busy}>
                                Stop
                              </Button>
                            ) : null}

                            {showRemove ? (
                              <Button size="sm" variant="outline-danger" onClick={() => removeJob(j.id)} disabled={busy}>
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {s === "error" ? (
                          <div className="mt-2 text-danger small">
                            {j.error ? String(j.error) : "Error (no message)"}
                          </div>
                        ) : null}

                        {s === "stopped" ? (
                          <div className="mt-2 text-muted small">Stopped: {formatDateTimeLocal(j.stoppedAt)}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card border="light" className="shadow-sm h-100">
            <Card.Header>
              <h5 className="mb-0">Saved Drafts</h5>
              <small className="text-muted">Save multiple drafts and load any one later</small>
            </Card.Header>
            <Card.Body>
              {!drafts.length ? (
                <div className="text-muted small">No saved drafts.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {drafts.slice(0, 8).map((d) => (
                    <div
                      key={d.key}
                      style={{
                        border: "1px solid #e9ecef",
                        borderRadius: 10,
                        padding: 10
                      }}
                    >
                      <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 10 }}>
                        <div style={{ minWidth: 200 }}>
                          <div className="fw-bold">{d.name || d.key}</div>
                          <div className="text-muted small">Updated: {formatDateTimeLocal(d.updatedAt || d.createdAt)}</div>
                        </div>
                        <div className="d-flex" style={{ gap: 8, flexWrap: "wrap" }}>
                          <Button size="sm" variant="primary" onClick={() => loadDraft(d.key)} disabled={busy}>
                            Load
                          </Button>
                          <Button size="sm" variant="outline-secondary" onClick={() => renameDraft(d.key)} disabled={busy}>
                            Rename
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => deleteDraft(d.key)} disabled={busy}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {drafts.length > 8 ? <div className="text-muted small mt-2">Showing latest 8 drafts.</div> : null}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card border="light" className="shadow-sm mb-3">
        <Card.Header>
          <h5 className="mb-0">Call Out Details</h5>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Area</Form.Label>
                <Form.Control value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g., Pump Room / Warehouse" />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>System type</Form.Label>
                <Form.Control value={systemType} onChange={(e) => setSystemType(e.target.value)} placeholder="e.g., Sprinkler / Gas Suppression / Detection" />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  Time of call logged
                  <div className="text-muted small">Time call received and recorded (hh:mm / date)</div>
                </Form.Label>
                <Form.Control type="datetime-local" value={timeCallLogged} onChange={(e) => setTimeCallLogged(e.target.value)} />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  Call logged by
                  <div className="text-muted small">Call received/recorded by (name and role/department)</div>
                </Form.Label>
                <Row className="g-2">
                  <Col xs={12} md={6}>
                    <Form.Control value={callLoggedByName} onChange={(e) => setCallLoggedByName(e.target.value)} placeholder="Name" />
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Control value={callLoggedByRole} onChange={(e) => setCallLoggedByRole(e.target.value)} placeholder="Role / Department" />
                  </Col>
                </Row>
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>
                  Client description of the defect
                  <div className="text-muted small">Client-reported fault/defect description (as reported)</div>
                </Form.Label>
                <Form.Control as="textarea" rows={4} value={clientDefectDesc} onChange={(e) => setClientDefectDesc(e.target.value)} placeholder="What did the client report?" />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  Time of responder arrival on site
                  <div className="text-muted small">Technician/responder on-site arrival time (hh:mm / date)</div>
                </Form.Label>
                <Form.Control type="datetime-local" value={timeArrival} onChange={(e) => setTimeArrival(e.target.value)} />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  Time of responder departure from site
                  <div className="text-muted small">Technician/responder departure time (hh:mm / date)</div>
                </Form.Label>
                <Form.Control type="datetime-local" value={timeDeparture} onChange={(e) => setTimeDeparture(e.target.value)} />
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>
                  Responder description of defect
                  <div className="text-muted small">Technician assessment and confirmed fault description</div>
                </Form.Label>
                <Form.Control as="textarea" rows={4} value={responderDefectDesc} onChange={(e) => setResponderDefectDesc(e.target.value)} placeholder="What was found on site?" />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  Could the defect be rectified?
                  <div className="text-muted small">Rectification possible during this attendance? (Yes/No)</div>
                </Form.Label>
                <Form.Select value={couldRectify} onChange={(e) => setCouldRectify(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="YES">Yes</option>
                  <option value="NO">No</option>
                </Form.Select>
              </Form.Group>
            </Col>

            {couldRectify === "YES" ? (
              <Col md={6}>
                <Form.Group>
                  <Form.Label>
                    Action taken by responder
                    <div className="text-muted small">Corrective actions undertaken on site (work performed and outcome)</div>
                  </Form.Label>
                  <Form.Control as="textarea" rows={4} value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} placeholder="Describe what was done and outcome." />
                </Form.Group>
              </Col>
            ) : null}

            {couldRectify === "NO" ? (
              <Col md={12}>
                <Form.Group>
                  <Form.Label>
                    List equipment/material to rectify the defect
                    <div className="text-muted small">Items/parts/materials required (qty, specs, urgency)</div>
                  </Form.Label>
                  <Form.Control as="textarea" rows={4} value={materialsRequired} onChange={(e) => setMaterialsRequired(e.target.value)} placeholder="e.g., 1x solenoid valve 24VDC (urgent), 2x detector bases..." />
                </Form.Group>
              </Col>
            ) : null}

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  Was a jobcard created for the call out?
                  <div className="text-muted small">Job card/work order raised for this call-out? (Yes/No)</div>
                </Form.Label>
                <Form.Select value={jobcardCreated} onChange={(e) => setJobcardCreated(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="YES">Yes</option>
                  <option value="NO">No</option>
                </Form.Select>
              </Form.Group>
            </Col>

            {jobcardCreated === "YES" ? (
              <Col md={6}>
                <Form.Group>
                  <Form.Label>
                    Jobcard number
                    <div className="text-muted small">Job card/work order reference number</div>
                  </Form.Label>
                  <Form.Control value={jobcardNumber} onChange={(e) => setJobcardNumber(e.target.value)} placeholder="e.g., JC-12345" />
                </Form.Group>
              </Col>
            ) : null}

            {jobcardCreated === "NO" ? (
              <Col md={12}>
                <Form.Group>
                  <Form.Label>
                    If no job card raised
                    <div className="text-muted small">Record reason/authorisation (advice only / false alarm / no access / client declined)</div>
                  </Form.Label>
                  <Form.Control as="textarea" rows={3} value={noJobcardReason} onChange={(e) => setNoJobcardReason(e.target.value)} placeholder="Reason and authorisation" />
                </Form.Group>
              </Col>
            ) : null}
          </Row>
        </Card.Body>
      </Card>

      <Card border="light" className="shadow-sm mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
          <div>
            <h5 className="mb-0">Pictures</h5>
            <small className="text-muted">Add one or multiple pictures and a description for each</small>
          </div>

          <div className="d-flex align-items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <Badge bg="info">{photos.length} photo(s)</Badge>
            <Button variant="primary" size="sm" onClick={triggerPhotoPicker}>
              Add picture
            </Button>
          </div>
        </Card.Header>

        <Card.Body>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            {...(isMobile ? { capture: "environment" } : {})}
            style={{ display: "none" }}
            onChange={(e) => onPhotosSelected(e.target.files)}
          />

          {!photos.length ? (
            <div className="text-muted small">No photos added.</div>
          ) : (
            <Row className="g-3">
              {photos.map((p) => (
                <Col key={p.id} xs={12} md={6} lg={4}>
                  <Card className="h-100">
                    <Card.Body>
                      {p.dataUrl ? (
                        <img src={p.dataUrl} alt={p.name} style={{ width: "100%", borderRadius: 8, border: "1px solid #ced4da" }} />
                      ) : null}

                      <div className="mt-2 text-muted small" style={{ wordBreak: "break-word" }}>
                        {p.name}
                      </div>

                      <Form.Group className="mt-2">
                        <Form.Label className="small mb-1">Description</Form.Label>
                        <Form.Control value={p.description || ""} onChange={(e) => updatePhoto(p.id, { description: e.target.value })} placeholder="Describe what this photo shows" />
                      </Form.Group>

                      <div className="d-flex justify-content-end mt-3">
                        <Button variant="outline-danger" size="sm" onClick={() => removePhoto(p.id)}>
                          Remove
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Card.Body>
      </Card>

      <Card border="light" className="shadow-sm">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 10 }}>
          <div>
            <h5 className="mb-0">Actions</h5>
            <small className="text-muted">Report generation</small>
          </div>
          <Button variant="outline-secondary" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Back to top
          </Button>
        </Card.Header>
        <Card.Body>
          <div className="d-flex flex-wrap" style={{ gap: 10 }}>
            <Button variant="secondary" onClick={saveOfflineDraft} disabled={busy}>
              {busy ? "Working..." : "Save Draft"}
            </Button>
            <Button variant="success" onClick={generateWithAutoDraft} disabled={busy}>
              {busy ? "Working..." : "Generate Report"}
            </Button>
            <Button variant="outline-danger" onClick={resetForm} disabled={busy}>
              Clear form
            </Button>
          </div>
        </Card.Body>
      </Card>
    </>
  );
}
