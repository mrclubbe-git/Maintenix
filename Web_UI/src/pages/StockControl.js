import React, { useEffect, useMemo, useState } from "react";
import {
  Row,
  Col,
  Card,
  Badge,
  Button,
  Form,
  InputGroup,
  Alert,
  Spinner,
  Modal
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faSyncAlt,
  faPlus,
  faEdit,
  faArrowDown,
  faSlidersH,
  faFileCsv,
  faTrash
} from "@fortawesome/free-solid-svg-icons";

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function safeRole(x) {
  return String(x || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function statusFor(qty, minQty) {
  const q = Number(qty || 0);
  const m = Number(minQty || 0);
  if (q <= 0) return "OUT";
  if (q <= m) return "LOW";
  return "OK";
}

function timeAgo(isoString) {
  if (!isoString) return "-";
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return "-";

  const diffSeconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  const units = [
    { name: "day", seconds: 60 * 60 * 24 },
    { name: "hour", seconds: 60 * 60 },
    { name: "minute", seconds: 60 },
    { name: "second", seconds: 1 }
  ];

  for (const u of units) {
    const v = Math.floor(diffSeconds / u.seconds);
    if (v >= 1) return `${v} ${u.name}${v === 1 ? "" : "s"} ago`;
  }
  return "Just now";
}

/**
 * ✅ Event-pooling safe field setters
 * Always capture e.target.value BEFORE setState(updater)
 */
function setField(setter, field) {
  return (e) => {
    const value = e?.target?.value ?? "";
    setter((p) => ({ ...p, [field]: value }));
  };
}

// ----------------------
// ✅ CSV helpers (client-side export)
// ----------------------
function csvCell(value) {
  const v = value === null || value === undefined ? "" : String(value);
  // Escape double quotes by doubling them, wrap if it contains delimiter/newline/quote
  const needsWrap = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsWrap ? `"${escaped}"` : escaped;
}

function downloadCsvFile(filename, headers, rows) {
  const headerLine = headers.map(csvCell).join(",");
  const bodyLines = rows.map((r) => r.map(csvCell).join(","));
  const csv = [headerLine, ...bodyLines].join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const blobUrl = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(blobUrl);
}

export default function StockControl() {
  const authToken = localStorage.getItem("authToken") || "";
  const authUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);
  const roleKey = safeRole(authUser?.role);

  const isAdmin = roleKey === "ADMIN";
  const isL1 = roleKey === "L1" || roleKey === "LEVEL1" || roleKey === "LEVEL_1" || roleKey === "USER";
  const isL2 = roleKey === "L2" || roleKey === "LEVEL2" || roleKey === "LEVEL_2";
  const isL3 = roleKey === "L3";

  // ----------------------
  // Role capabilities (UI gating)
  // Admin = full
  // L1 = add item, issue, receive
  // L2 = same as L1 + CSV download
  // L3 = all stock functions excluding delete
  // ----------------------
  const canAddItem = isAdmin || isL1 || isL2 || isL3;
  const canIssue = isAdmin || isL1 || isL2 || isL3;        // Delivery Note issue builder
  const canReceive = isAdmin || isL1 || isL2 || isL3;

  const canEditItem = isAdmin || isL3;                     // edit metadata
  const canAdjust = isAdmin || isL3;                       // adjust qty
  const canDelete = isAdmin;                               // delete item
  const canDownloadCsv = isAdmin || isL2 || isL3;           // CSV exports
  const canViewAudit = isAdmin || isL2 || isL3;             // view movements

  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMoves, setLoadingMoves] = useState(false);

  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL"); // ALL | OK | LOW | OUT

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    unit: "unit",
    location: "Main",
    qty: "0",
    minQty: "0"
  });

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    unit: "",
    location: "",
    minQty: "0"
  });

  // Move modal (Receive / Adjust only in UI now)
  const [showMove, setShowMove] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveItem, setMoveItem] = useState(null);
  const [moveForm, setMoveForm] = useState({
    type: "RECEIVE",
    qty: "0",
    reason: ""
  });

  // ----------------------
  // ✅ Issue (Delivery Note) list-builder
  // ----------------------
  const [showIssue, setShowIssue] = useState(false);
  const [issueLines, setIssueLines] = useState([{ itemId: "", qty: "1" }]);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [issueSubmitting, setIssueSubmitting] = useState(false);

  const [issueMeta, setIssueMeta] = useState({
    customerCompany: "",
    deliveryAddress: "",
    collectedBy: "",
    releasedBy: authUser?.name || authUser?.email || "",
    date: new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  });

  const [issueOk, setIssueOk] = useState({ url: "", filename: "" });
  // ----------------------
  // ✅ Admin exports + audit log maintenance
  // ----------------------
  function downloadInventoryCsv() {
    const headers = ["ID", "Item", "UOM", "Qty", "MinQty", "Status", "Location"];
    const rows = (items || []).map((i) => {
      const status = statusFor(i?.qty, i?.minQty);
      return [i?.id || "", i?.name || "", i?.unit || "", Number(i?.qty || 0), Number(i?.minQty || 0), status, i?.location || ""];
    });
    downloadCsvFile(`inventory_items_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  function downloadAuditLogCsv() {
    const headers = ["When", "Item", "ItemId", "Type", "FromQty", "ToQty", "By", "Reason"];
    const rows = (movements || []).map((m) => {
      const itemName = items.find((x) => x.id === m.itemId)?.name || "";
      return [
        m?.at || "",
        itemName || "",
        m?.itemId || "",
        m?.type || "",
        Number(m?.fromQty ?? 0),
        Number(m?.toQty ?? 0),
        m?.by || "",
        m?.reason || ""
      ];
    });
    downloadCsvFile(`audit_log_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  async function clearAuditLog() {
    if (!isAdmin) return;

    const ok = window.confirm("Clear audit log? (Admin only)\n\nIf the backend does not support clearing yet, this will only clear the view.");
    if (!ok) return;

    setErr("");
    try {
      // Preferred: implement a backend DELETE endpoint (admin only) that clears the audit log permanently.
      // Example: DELETE /api/stock/movements
      const res = await fetch("/api/stock/movements", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` }
      });

      // Some servers may return 204 No Content
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // If the backend doesn't support clearing yet, fall back to clearing the view only.
        if (res.status === 404 || res.status === 405) {
          setMovements([]);
          setErr("Audit log cleared from view only (backend clear endpoint not implemented).");
          return;
        }
        setErr(data?.message || `Clear failed (HTTP ${res.status}).`);
        return;
      }

      setMovements([]);
    } catch {
      // If offline / API unreachable, clear view only
      setMovements([]);
      setErr("Audit log cleared from view only (API not reachable).");
    }
  }


  async function downloadDeliveryNote(url, fileName) {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }
    if (!url) {
      setErr("No delivery note URL found.");
      return;
    }

    setErr("");
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.message || `Download failed (HTTP ${res.status}).`);
        return;
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName || "delivery_note.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(blobUrl);
    } catch {
      setErr("Download failed (API not reachable).");
    }
  }

  function closeIssueWidget() {
    setShowIssue(false);
    setShowIssueConfirm(false);
    setIssueOk({ url: "", filename: "" });
    setIssueLines([{ itemId: "", qty: "1" }]);
    setIssueMeta((m) => ({
      ...m,
      customerCompany: "",
      deliveryAddress: "",
      collectedBy: "",
      releasedBy: m.releasedBy || (authUser?.name || authUser?.email || ""),
      date: new Date().toISOString().slice(0, 10)
    }));
  }

  async function loadItems({ manual = false } = {}) {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      setItems([]);
      return;
    }

    if (manual) setRefreshing(true);
    else setLoading(true);

    setErr("");
    try {
      const res = await fetch("/api/stock/items", {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Failed to load stock items (HTTP ${res.status}).`);
        setItems([]);
        return;
      }

      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setErr("Failed to load stock items (API not reachable).");
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadMovements() {
    if (!authToken || !canViewAudit) return;
    setLoadingMoves(true);
    try {
      const res = await fetch("/api/stock/movements", {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadingMoves(false);
        return;
      }
      setMovements(Array.isArray(data.movements) ? data.movements : []);
      setLoadingMoves(false);
    } catch {
      setLoadingMoves(false);
    }
  }

  useEffect(() => {
    loadItems();
    loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const locations = useMemo(() => {
    const set = new Set();
    items.forEach((i) => {
      const loc = String(i.location || "").trim();
      if (loc) set.add(loc);
    });
    return ["ALL", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;

    const loc = String(locationFilter || "ALL");
    if (loc !== "ALL") out = out.filter((i) => String(i.location || "") === loc);

     // ✅ NEW: status filter
     const sf = String(statusFilter || "ALL").toUpperCase();
     if (sf !== "ALL") {
       out = out.filter((i) => statusFor(i.qty, i.minQty) === sf);
     }

    const q = String(search || "").trim().toLowerCase();
    if (q) {
      out = out.filter((i) => {
        const name = String(i.name || "").toLowerCase();
        const uom = String(i.unit || "").toLowerCase();
        const location = String(i.location || "").toLowerCase();
        return name.includes(q) || uom.includes(q) || location.includes(q);
      });
    }
    return out;
  }, [items, search, locationFilter, statusFilter]);

  const counters = useMemo(() => {
    let total = filtered.length;
    let low = 0;
    let out = 0;
    filtered.forEach((i) => {
      const s = statusFor(i.qty, i.minQty);
      if (s === "LOW") low += 1;
      if (s === "OUT") out += 1;
    });
    return { total, low, out };
  }, [filtered]);

  function statusBadge(i) {
    const s = statusFor(i.qty, i.minQty);
    if (s === "OK") return <Badge bg="success">OK</Badge>;
    if (s === "LOW") return <Badge bg="warning">Low</Badge>;
    return <Badge bg="danger">Out</Badge>;
  }

  async function addItem() {
    const name = String(addForm.name || "").trim();
    const unit = String(addForm.unit || "").trim() || "unit";
    const location = String(addForm.location || "").trim() || "Main";
    const qty = Number(addForm.qty ?? 0);
    const minQty = Number(addForm.minQty ?? 0);

    if (!name) return setErr("Item name is required.");
    if (!Number.isFinite(qty) || qty < 0) return setErr("Qty must be 0 or more.");
    if (!Number.isFinite(minQty) || minQty < 0) return setErr("Min qty must be 0 or more.");

    setAdding(true);
    setErr("");
    try {
      const res = await fetch("/api/stock/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name, unit, location, qty, minQty })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Add failed (HTTP ${res.status}).`);
        setAdding(false);
        return;
      }

      setShowAdd(false);
      setAddForm({ name: "", unit: "unit", location: "Main", qty: "0", minQty: "0" });
      await loadItems({ manual: true });
      await loadMovements();
      setAdding(false);
    } catch {
      setErr("Add failed (API not reachable).");
      setAdding(false);
    }
  }

  function openEdit(i) {
    setEditItem(i);
    setEditForm({
      name: i?.name || "",
      unit: i?.unit || "unit",
      location: i?.location || "Main",
      minQty: String(Number(i?.minQty ?? 0))
    });
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!editItem?.id) return;

    const name = String(editForm.name || "").trim();
    const unit = String(editForm.unit || "").trim() || "unit";
    const location = String(editForm.location || "").trim() || "Main";
    const minQty = Number(editForm.minQty ?? 0);

    if (!name) return setErr("Item name is required.");
    if (!Number.isFinite(minQty) || minQty < 0) return setErr("Min qty must be 0 or more.");

    setEditing(true);
    setErr("");
    try {
      const res = await fetch(`/api/stock/items/${encodeURIComponent(editItem.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ name, unit, location, minQty })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Save failed (HTTP ${res.status}).`);
        setEditing(false);
        return;
      }

      setShowEdit(false);
      setEditItem(null);
      await loadItems({ manual: true });
      await loadMovements();
      setEditing(false);
    } catch {
      setErr("Save failed (API not reachable).");
      setEditing(false);
    }
  }



  async function deleteStockItem(item) {
    if (!isAdmin) return;
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }
    const id = String(item?.id || "");
    if (!id) return;

    const ok = window.confirm(`Delete item "${item?.name || id}"? This cannot be undone.`);
    if (!ok) return;

    setErr("");
    try {
      const res = await fetch(`/api/stock/items/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Delete failed (HTTP ${res.status}).`);
        return;
      }

      await loadItems({ manual: true });
      await loadMovements(); // movements are kept on backend (by design)
    } catch {
      setErr("Delete failed (API not reachable).");
    }
  }

function openMove(i, type) {
    setMoveItem(i);
    setMoveForm({ type, qty: "0", reason: "" });
    setShowMove(true);
  }

  async function submitMove() {
    if (!moveItem?.id) return;

    const type = String(moveForm.type || "").trim().toUpperCase();
    const qty = Number(moveForm.qty ?? 0);
    const reason = String(moveForm.reason || "").trim();

    if (!["RECEIVE", "ISSUE", "ADJUST"].includes(type)) return setErr("Invalid move type.");
    if (!Number.isFinite(qty) || qty < 0) return setErr("Qty must be 0 or more.");

    setMoving(true);
    setErr("");
    try {
      const res = await fetch("/api/stock/move", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ itemId: moveItem.id, type, qty, reason })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Move failed (HTTP ${res.status}).`);
        setMoving(false);
        return;
      }

      setShowMove(false);
      setMoveItem(null);
      await loadItems({ manual: true });
      await loadMovements();
      setMoving(false);
    } catch {
      setErr("Move failed (API not reachable).");
      setMoving(false);
    }
  }

  // ----------------------
  // ✅ Issue list builder helpers
  // ----------------------
  function openIssueBuilder() {
    setErr("");
    setIssueOk({ url: "", filename: "" });

    setIssueLines([{ itemId: "", qty: "1" }]);

    setIssueMeta((m) => ({
      ...m,
      customerCompany: "",
      deliveryAddress: "",
      releasedBy: m.releasedBy || (authUser?.name || authUser?.email || ""),
      date: m.date || new Date().toISOString().slice(0, 10)
    }));

    setShowIssue(true);
  }

  function addIssueRow() {
    setIssueLines((prev) => [...prev, { itemId: "", qty: "1" }]);
  }

  function removeIssueRow(idx) {
    setIssueLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateIssueRow(idx, patch) {
    setIssueLines((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function proceedToIssueConfirm() {
    setErr("");

    const normalized = issueLines
      .map((r) => ({ itemId: String(r.itemId || ""), qty: Number(r.qty) }))
      .filter((r) => r.itemId && Number.isFinite(r.qty) && r.qty > 0);

    if (!normalized.length) {
      setErr("Please add at least 1 item with a quantity > 0.");
      return;
    }

    const seen = new Set();
    for (const r of normalized) {
      if (seen.has(r.itemId)) {
        setErr("Each item can only be added once. Remove duplicates.");
        return;
      }
      seen.add(r.itemId);
    }

    setShowIssue(false);
    setShowIssueConfirm(true);
  }

  async function submitIssueNote() {
    setErr("");
    setIssueOk({ url: "", filename: "" });

    if (!authToken) {
      setErr("Token missing. Please sign in again.");
      return;
    }

    const customerCompany = String(issueMeta.customerCompany || "").trim();
    const deliveryAddress = String(issueMeta.deliveryAddress || "").trim();
    const collectedBy = String(issueMeta.collectedBy || "").trim();
    const releasedBy = String(issueMeta.releasedBy || "").trim();
    const date = String(issueMeta.date || "").trim();

    if (!customerCompany) return setErr("Customer / Company is required.");
    if (!deliveryAddress) return setErr("Delivery address is required.");
    if (!collectedBy) return setErr("Collected By is required.");
    if (!releasedBy) return setErr("Released By is required.");
    if (!date) return setErr("Date is required.");

    const lines = issueLines
      .map((r) => ({ itemId: String(r.itemId || ""), qty: Number(r.qty) }))
      .filter((r) => r.itemId && Number.isFinite(r.qty) && r.qty > 0);

    if (!lines.length) return setErr("Please add at least 1 valid line.");

    setIssueSubmitting(true);
    try {
      const res = await fetch("/api/stock/issue-note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ customerCompany, deliveryAddress, collectedBy, releasedBy, date, lines })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Issue failed (HTTP ${res.status}).`);
        setIssueSubmitting(false);
        return;
      }

      setIssueOk({ url: data.url || "", filename: data.filename || "" });

      // Refresh stock + movements after issuing
      await loadItems({ manual: true });
      await loadMovements();

      setIssueSubmitting(false);
    } catch {
      setErr("Issue failed (API not reachable).");
      setIssueSubmitting(false);
    }
  }

  const issuePreviewLines = useMemo(() => {
    return issueLines
      .map((r) => ({
        item: items.find((x) => x.id === r.itemId) || null,
        qty: Number(r.qty)
      }))
      .filter((x) => x.item && Number.isFinite(x.qty) && x.qty > 0);
  }, [issueLines, items]);

  return (
    <>
      <div className="d-flex flex-column flex-lg-row justify-content-between align-items-stretch align-items-lg-center py-4" style={{ gap: 12 }}>
        <div>
          <h4 className="mb-0">Stock Control</h4>
          <small className="text-muted">Inventory</small>
        </div>

        {/* Mobile: stack controls vertically (xs) so they stay inside the screen.
            Desktop: keep inline like original (sm+). */}
        <div
          className="d-flex flex-column flex-sm-row flex-wrap align-items-stretch align-items-sm-center"
          style={{ gap: 8, maxWidth: "100%" }}
        >
          <div style={{ width: "100%", maxWidth: 170 }}>
              <Form.Select
                size="sm"
                style={{ width: "100%" }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                disabled={loading || refreshing}
              >
                <option value="ALL">All statuses</option>
                <option value="OK">OK</option>
                <option value="LOW">Low</option>
                <option value="OUT">Out</option>
              </Form.Select>
            </div>

          <div style={{ width: "100%", maxWidth: 190 }}>
            <Form.Select
              size="sm"
              style={{ width: "100%" }}
              value={locationFilter}
              onChange={(e) => {
                const value = e.target.value;
                setLocationFilter(value);
              }}
              disabled={loading || refreshing}
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "ALL" ? "All locations" : loc}
                </option>
              ))}
            </Form.Select>
          </div>

          <div style={{ width: "100%", maxWidth: 320 }}>
            <InputGroup size="sm" style={{ width: "100%" }}>
              <InputGroup.Text>
                <FontAwesomeIcon icon={faSearch} />
              </InputGroup.Text>
              <Form.Control
                placeholder="Search item / UOM / location…"
                value={search}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearch(value);
                }}
                disabled={loading || refreshing}
              />
            </InputGroup>
          </div>

          <Button
            variant="outline-primary"
            size="sm"
            onClick={async () => {
              await loadItems({ manual: true });
              await loadMovements();
            }}
            disabled={loading || refreshing}
            style={{ width: "100%", maxWidth: 160 }}
          >
            <FontAwesomeIcon icon={faSyncAlt} className="me-2" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>

          {/* ✅ Delivery Note Issue Builder (Admin/L1/L2/L3) */}
          {canIssue ? (
            <Button
              variant="outline-danger"
              size="sm"
              onClick={openIssueBuilder}
              disabled={loading || refreshing}
              style={{ width: "100%", maxWidth: 120 }}
            >
              Issue
            </Button>
          ) : null}

          {canAddItem ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAdd(true)}
              disabled={loading || refreshing}
              style={{ width: "100%", maxWidth: 160 }}
            >
              <FontAwesomeIcon icon={faPlus} className="me-2" />
              Add item
            </Button>
          ) : null}
        </div>
      </div>

      {err ? <Alert variant="danger">{err}</Alert> : null}

      <Row className="mb-4">
        <Col xs={12} md={4} className="mb-3 mb-md-0">
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Items</div>
              <div className="h3 mb-0">{counters.total}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={12} md={4} className="mb-3 mb-md-0">
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Low stock</div>
              <div className="h3 mb-0">{counters.low}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Out of stock</div>
              <div className="h3 mb-0">{counters.out}</div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card border="light" className="shadow-sm">
        <Card.Header className="d-flex flex-column flex-sm-row justify-content-between align-items-stretch align-items-sm-center" style={{ gap: 10 }}>
          <h5 className="mb-0">Inventory Items</h5>
          <div className="d-flex align-items-center" style={{ gap: 10 }}>
              {canDownloadCsv ? (
                <Button variant="outline-secondary" size="sm" onClick={downloadInventoryCsv} disabled={loading || refreshing || items.length === 0}>
                  <FontAwesomeIcon icon={faFileCsv} className="me-2" />
                  Download CSV
                </Button>
              ) : null}
            </div>
        </Card.Header>

        <Card.Body className="p-0">
          {loading ? (
            <div className="p-3 text-muted">
              <Spinner size="sm" className="me-2" /> Loading…
            </div>
          ) : null}

          <div className="p-3">
            {filtered.length === 0 ? (
              <div className="text-muted py-4 text-center">No items found.</div>
            ) : (
              <Row className="g-3">
                {filtered.map((i) => (
                  <Col key={i.id} xs={12}>
                    <Card border="light" className="shadow-sm h-100">
                      <Card.Body>
                        <div className="d-md-none">
                          <div className="d-flex justify-content-between align-items-start" style={{ gap: 10 }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="fw-bold text-break">{i.name}</div>
                              <div className="small text-muted text-break">{i.location || "No location"} · {i.unit || "unit"}</div>
                            </div>
                            {statusBadge(i)}
                          </div>

                          <Row className="mt-3 text-center">
                            <Col xs={4}>
                              <div className="text-muted small">UOM</div>
                              <div className="h6 mb-0 text-truncate">{i.unit || "-"}</div>
                            </Col>
                            <Col xs={4}>
                              <div className="text-muted small">Min Qty</div>
                              <div className="h5 mb-0">{Number(i.minQty || 0)}</div>
                            </Col>
                            <Col xs={4}>
                              <div className="text-muted small">Qty</div>
                              <div className="h4 mb-0">{Number(i.qty || 0)}</div>
                            </Col>
                          </Row>
                        </div>

                        <div className="d-none d-md-flex align-items-start" style={{ gap: 14 }}>
                          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                            <div className="fw-bold text-break">{i.name}</div>
                            <div className="small text-muted text-break">{i.location || "No location"}</div>
                          </div>
                          <div className="d-flex align-items-start flex-wrap justify-content-end" style={{ gap: 8, flex: "0 0 auto", maxWidth: "52%" }}>
                            <Badge bg="light" text="dark" className="px-3 py-2">UOM: {i.unit || "-"}</Badge>
                            <Badge bg="light" text="dark" className="px-3 py-2">Min Qty: {Number(i.minQty || 0)}</Badge>
                            <Badge bg="light" text="dark" className="px-3 py-2">Qty: {Number(i.qty || 0)}</Badge>
                            {statusBadge(i)}
                          </div>
                        </div>

                        {(canReceive || canAdjust || canEditItem || canDelete) ? (
                          <div className="d-flex flex-wrap mt-3" style={{ gap: 8 }}>
                            {canReceive ? (
                              <Button size="sm" variant="outline-success" onClick={() => openMove(i, "RECEIVE")}>
                                <FontAwesomeIcon icon={faArrowDown} className="me-2" />Receive
                              </Button>
                            ) : null}
                            {canAdjust ? (
                              <Button size="sm" variant="outline-primary" onClick={() => openMove(i, "ADJUST")}>
                                <FontAwesomeIcon icon={faSlidersH} className="me-2" />Adjust
                              </Button>
                            ) : null}
                            {canEditItem ? (
                              <Button size="sm" variant="outline-secondary" onClick={() => openEdit(i)}>
                                <FontAwesomeIcon icon={faEdit} className="me-2" />Edit
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button size="sm" variant="outline-danger" onClick={() => deleteStockItem(i)}>
                                <FontAwesomeIcon icon={faTrash} className="me-2" />Delete
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </Card.Body>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* Movement History (Admin/L2/L3) */}
      {canViewAudit ? (
        <Card border="light" className="shadow-sm mt-4">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Recent stock movements</h5>
            <div className="d-flex align-items-center" style={{ gap: 10 }}>
              <>
                {canDownloadCsv ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={downloadAuditLogCsv}
                    disabled={loadingMoves || movements.length === 0}
                    title="Download audit log as CSV"
                  >
                    <FontAwesomeIcon icon={faFileCsv} className="me-2" />
                    Download CSV
                  </Button>
                ) : null}

                {isAdmin ? (
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={clearAuditLog}
                    disabled={loadingMoves}
                    title="Clear audit log (Admin only)"
                  >
                    <FontAwesomeIcon icon={faTrash} className="me-2" />
                    Clear log
                  </Button>
                ) : null}
              </>
            </div>
          </Card.Header>
          <Card.Body className="p-0">
            {loadingMoves ? (
              <div className="p-3 text-muted">
                <Spinner size="sm" className="me-2" /> Loading movements…
              </div>
            ) : null}

            <div className="p-3">
              {movements.length === 0 ? (
                <div className="text-muted py-4 text-center">No movements yet.</div>
              ) : (
                <Row className="g-3">
                  {movements.slice(0, 30).map((m) => {
                    const itemName = items.find((x) => x.id === m.itemId)?.name || m.itemId;
                    return (
                      <Col key={m.id} xs={12}>
                        <Card border="light" className="shadow-sm h-100">
                          <Card.Body>
                            <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div className="fw-bold text-break">{itemName}</div>
                                <div className="small text-muted">{timeAgo(m.at)} · {m.by || "Unknown user"}</div>
                              </div>
                              <Badge bg="light" text="dark">{m.type || "Movement"}</Badge>
                            </div>
                            <div className="d-flex flex-wrap mt-3" style={{ gap: 12 }}>
                              <div><span className="text-muted small d-block">From</span><span className="fw-bold">{Number(m.fromQty ?? 0)}</span></div>
                              <div><span className="text-muted small d-block">To</span><span className="fw-bold">{Number(m.toQty ?? 0)}</span></div>
                              <div className="flex-grow-1"><span className="text-muted small d-block">Reason</span><span className="text-break">{m.reason || "-"}</span></div>
                            </div>
                          </Card.Body>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              )}
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {/* Add Item Modal */}
      <Modal show={showAdd} onHide={() => (adding ? null : setShowAdd(false))} centered>
        <Modal.Header closeButton={!adding}>
          <Modal.Title>Add item</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Item name</Form.Label>
              <Form.Control value={addForm.name} onChange={setField(setAddForm, "name")} disabled={adding} />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>UOM</Form.Label>
                  <Form.Control value={addForm.unit} onChange={setField(setAddForm, "unit")} disabled={adding} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Location</Form.Label>
                  <Form.Control value={addForm.location} onChange={setField(setAddForm, "location")} disabled={adding} />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Initial qty</Form.Label>
                  <Form.Control type="number" min={0} value={addForm.qty} onChange={setField(setAddForm, "qty")} disabled={adding} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Min qty</Form.Label>
                  <Form.Control type="number" min={0} value={addForm.minQty} onChange={setField(setAddForm, "minQty")} disabled={adding} />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={adding}>
            Cancel
          </Button>
          <Button variant="primary" onClick={addItem} disabled={adding}>
            {adding ? (
              <>
                <Spinner size="sm" className="me-2" /> Adding…
              </>
            ) : (
              "Add"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Modal */}
      <Modal show={showEdit} onHide={() => (editing ? null : setShowEdit(false))} centered>
        <Modal.Header closeButton={!editing}>
          <Modal.Title>Edit item</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Item name</Form.Label>
              <Form.Control value={editForm.name} onChange={setField(setEditForm, "name")} disabled={editing} />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>UOM</Form.Label>
                  <Form.Control value={editForm.unit} onChange={setField(setEditForm, "unit")} disabled={editing} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Location</Form.Label>
                  <Form.Control value={editForm.location} onChange={setField(setEditForm, "location")} disabled={editing} />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Min qty</Form.Label>
              <Form.Control type="number" min={0} value={editForm.minQty} onChange={setField(setEditForm, "minQty")} disabled={editing} />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEdit(false)} disabled={editing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={saveEdit} disabled={editing}>
            {editing ? (
              <>
                <Spinner size="sm" className="me-2" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Move Modal (Receive / Adjust / Issue via /api/stock/move if needed) */}
      <Modal show={showMove} onHide={() => (moving ? null : setShowMove(false))} centered>
        <Modal.Header closeButton={!moving}>
          <Modal.Title>
            {moveForm.type === "RECEIVE" ? "Receive stock" : moveForm.type === "ISSUE" ? "Issue stock" : "Adjust stock"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-2 text-muted small">
            Item: <span className="fw-bold">{moveItem?.name || "-"}</span>
          </div>

          <Form>
            <Form.Group className="mb-3">
              <Form.Label>{moveForm.type === "ADJUST" ? "Set quantity to" : "Quantity"}</Form.Label>
              <Form.Control type="number" min={0} value={moveForm.qty} onChange={setField(setMoveForm, "qty")} disabled={moving} />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Reason (optional)</Form.Label>
              <Form.Control value={moveForm.reason} onChange={setField(setMoveForm, "reason")} disabled={moving} />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowMove(false)} disabled={moving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submitMove} disabled={moving}>
            {moving ? (
              <>
                <Spinner size="sm" className="me-2" /> Saving…
              </>
            ) : (
              "Confirm"
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ---------------------------
          ✅ Issue Builder Modal (items + qty)
      ---------------------------- */}
      <Modal
        show={showIssue}
        onHide={() => (issueSubmitting ? null : setShowIssue(false))}
        centered
        size="lg"
      >
        <Modal.Header closeButton={!issueSubmitting}>
          <Modal.Title>Issue stock (build list)</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Alert variant="info" className="mb-3">
            Add one or more items to issue. You’ll confirm “Collected By / Released By / Date” in the next step.
          </Alert>

          {issueLines.map((row, idx) => (
            <Row key={idx} className="align-items-end g-2 mb-3">
              <Col md={8}>
                <Form.Group>
                  <Form.Label>Item</Form.Label>
                  <Form.Select
                    value={row.itemId}
                    onChange={(e) => {
                      const value = e.target.value;
                      updateIssueRow(idx, { itemId: value });
                    }}
                    disabled={issueSubmitting}
                  >
                    <option value="">Select item...</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.unit || "UOM"}) — On hand: {Number(it.qty || 0)}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group>
                  <Form.Label>Qty</Form.Label>
                  <Form.Control
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) => {
                      const value = e.target.value;
                      updateIssueRow(idx, { qty: value });
                    }}
                    disabled={issueSubmitting}
                  />
                </Form.Group>
              </Col>

              <Col md={1} className="d-flex justify-content-end">
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => removeIssueRow(idx)}
                  disabled={issueSubmitting || issueLines.length === 1}
                  title="Remove line"
                >
                  ×
                </Button>
              </Col>
            </Row>
          ))}

          <Button variant="outline-primary" size="sm" onClick={addIssueRow} disabled={issueSubmitting}>
            + Add another item
          </Button>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowIssue(false)} disabled={issueSubmitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={proceedToIssueConfirm} disabled={issueSubmitting}>
            Confirm list →
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ---------------------------
          ✅ Issue Confirm Modal (Collected/Released/Date)
      ---------------------------- */}
      <Modal
        show={showIssueConfirm}
        onHide={() => (issueSubmitting ? null : setShowIssueConfirm(false))}
        centered
      >
        <Modal.Header closeButton={!issueSubmitting}>
          <Modal.Title>Delivery Note details</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="mb-3">
            <div className="fw-bold mb-1">Items to issue</div>
            {issuePreviewLines.length ? (
              <ul className="mb-0">
                {issuePreviewLines.map((x, i) => (
                  <li key={i}>
                    {x.item.name} — {x.qty} {x.item.unit || ""}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted small">No valid lines selected.</div>
            )}
          </div>

          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Customer / Company</Form.Label>
              <Form.Control
                value={issueMeta.customerCompany}
                onChange={(e) => {
                  const value = e.target.value;
                  setIssueMeta((p) => ({ ...p, customerCompany: value }));
                }}
                disabled={issueSubmitting}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Delivery address</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={issueMeta.deliveryAddress}
                onChange={(e) => {
                  const value = e.target.value;
                  setIssueMeta((p) => ({ ...p, deliveryAddress: value }));
                }}
                disabled={issueSubmitting}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Collected By</Form.Label>
              <Form.Control
                value={issueMeta.collectedBy}
                onChange={(e) => {
                  const value = e.target.value;
                  setIssueMeta((p) => ({ ...p, collectedBy: value }));
                }}
                disabled={issueSubmitting}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Released By</Form.Label>
              <Form.Control
                value={issueMeta.releasedBy}
                onChange={(e) => {
                  const value = e.target.value;
                  setIssueMeta((p) => ({ ...p, releasedBy: value }));
                }}
                disabled={issueSubmitting}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Date</Form.Label>
              <Form.Control
                type="date"
                value={issueMeta.date}
                onChange={(e) => {
                  const value = e.target.value;
                  setIssueMeta((p) => ({ ...p, date: value }));
                }}
                disabled={issueSubmitting}
              />
            </Form.Group>
          </Form>

          {issueOk.url ? (
            <Alert variant="success" className="mb-0">
              Delivery note created: <strong>{issueOk.filename}</strong>
              <div className="mt-2">
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => downloadDeliveryNote(issueOk.url, issueOk.filename)}
                >
                  Download DOCX
                </Button>
              </div>
            </Alert>
          ) : null}
        </Modal.Body>

        <Modal.Footer>
          {!issueOk.url ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (issueSubmitting) return;
                setShowIssueConfirm(false);
                setShowIssue(true);
              }}
              disabled={issueSubmitting}
            >
              ← Back
            </Button>
          ) : null}

          <Button
            variant={issueOk.url ? "secondary" : "danger"}
            onClick={issueOk.url ? closeIssueWidget : submitIssueNote}
            disabled={issueSubmitting}
          >
            {issueSubmitting ? (
              <>
                <Spinner size="sm" className="me-2" /> Generating…
              </>
            ) : issueOk.url ? (
              "Close"
            ) : (
              "Generate delivery note"
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
