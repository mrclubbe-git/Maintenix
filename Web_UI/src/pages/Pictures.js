import React, { useEffect, useMemo, useState } from "react";
import {
  Card,
  Button,
  Dropdown,
  Spinner,
  Alert,
  Row,
  Col,
  Badge,
  Form,
  InputGroup,
  Modal,
  ButtonGroup
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faFilter, faSearch, faSyncAlt, faTrash, faTh, faList } from "@fortawesome/free-solid-svg-icons";

const RANGE_OPTIONS = ["TODAY", "PAST_7_DAYS", "30D", "90D", "LAST_MONTH", "YTD", "ALL"];
const PAGE_SIZE = 48;

function safeRole(x) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}
function canDownload(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L3" || r === "LEVEL3" || r === "LEVEL_3";
}
function canAdmin(role) {
  return safeRole(role) === "ADMIN";
}
function getStoredUser() {
  try {
    const raw = localStorage.getItem("authUser");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function getToken() {
  return localStorage.getItem("authToken") || "";
}
function getRangeLabel(r) {
  const v = String(r || "PAST_7_DAYS").toUpperCase();
  if (v === "TODAY") return "Today";
  if (v === "PAST_7_DAYS") return "Past 7 days";
  if (v === "30D") return "Past 30 days";
  if (v === "90D") return "Past 90 days";
  if (v === "LAST_MONTH") return "Last month";
  if (v === "YTD") return "YTD";
  if (v === "ALL") return "All";
  return "Past 7 days";
}
function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
function itemKey(row) {
  return `${row?.reportId || ""}::${row?.photo?.filename || ""}`;
}
function toDownloadName(row) {
  return row?.photo?.filename || "photo";
}

function AuthImage({ src, alt, authHeaders, style, className, loading = "lazy", onClick }) {
  const [objectUrl, setObjectUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let localUrl = "";

    async function loadImage() {
      setFailed(false);
      setObjectUrl("");
      if (!src) return;
      try {
        const res = await fetch(src, { headers: authHeaders || {} });
        if (!res.ok) throw new Error(`Image failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        localUrl = window.URL.createObjectURL(blob);
        setObjectUrl(localUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    loadImage();
    return () => {
      cancelled = true;
      if (localUrl) window.URL.revokeObjectURL(localUrl);
    };
  }, [src, authHeaders]);

  if (failed) {
    return (
      <div className={className} onClick={onClick} style={{ ...(style || {}), display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 12, padding: 12, textAlign: "center" }}>
        Preview unavailable. Use Download.
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className={className} onClick={onClick} style={{ ...(style || {}), display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  return <img src={objectUrl} alt={alt || ""} loading={loading} className={className} style={style} onClick={onClick} />;
}

export default function Pictures() {
  const user = getStoredUser();
  const role = user?.role || "";
  const token = getToken();
  const canDL = canDownload(role);
  const isAdmin = canAdmin(role);

  const [range, setRange] = useState("PAST_7_DAYS");
  const [section, setSection] = useState("ALL");
  const [month, setMonth] = useState("ALL");
  const [area, setArea] = useState("ALL");
  const [technician, setTechnician] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState("grid");

  const [rows, setRows] = useState([]);
  const [facets, setFacets] = useState({ sections: [], months: [], areas: [], technicians: [], services: [], types: [] });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [cleanup, setCleanup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState("");
  const [clearing, setClearing] = useState(false);
  const [selected, setSelected] = useState({});
  const [previewIndex, setPreviewIndex] = useState(-1);

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const selectedRows = useMemo(() => rows.filter((r) => selected[itemKey(r)]), [rows, selected]);
  const previewRow = previewIndex >= 0 ? rows[previewIndex] : null;

  async function fetchJson(url, init = {}) {
    const headers = { ...(init.headers || {}), ...authHeaders };
    if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { ...init, headers });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.message || `Request failed (${res.status})`);
    return data;
  }

  async function load(opts = {}) {
    const nextPage = opts.page || page;
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams({
        range,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        section,
        month,
        area,
        technician,
        type,
        q: search
      });
      const data = await fetchJson(`/api/photos?${params.toString()}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setFacets(data.facets || {});
      setTotal(Number(data.total || 0));
      setTotalPages(Number(data.totalPages || 1));
      setCleanup(data.cleanup || null);
      setPage(Number(data.page || nextPage));
      setSelected({});
      setPreviewIndex(-1);
    } catch (e) {
      setErr(String(e?.message || e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
    load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, section, month, area, technician, type]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load({ page: 1 });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function filterDropdown(label, value, options, onChange, allLabel = "All") {
    return (
      <Dropdown className="btn-toolbar">
        <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm">
          {label}: {value === "ALL" ? allLabel : value}
        </Dropdown.Toggle>
        <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end" style={{ maxHeight: 360, overflowY: "auto" }}>
          <Dropdown.Item active={value === "ALL"} onClick={() => onChange("ALL")}>{allLabel}</Dropdown.Item>
          {(options || []).map((o) => (
            <Dropdown.Item key={o} active={o === value} onClick={() => onChange(o)}>{o}</Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    );
  }

  async function downloadPhoto(row) {
    if (!canDL) return;
    try {
      const res = await fetch(row.photo.downloadUrl, { headers: authHeaders });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = toDownloadName(row);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }

  async function deletePhoto(row) {
    if (!isAdmin) return;
    if (!window.confirm("Delete this picture?")) return;
    const key = itemKey(row);
    setBusyId(key);
    setErr("");
    try {
      await fetchJson(`/api/photos/delete?reportId=${encodeURIComponent(row.reportId)}&filename=${encodeURIComponent(row.photo.filename)}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  async function bulkDelete() {
    if (!isAdmin || selectedRows.length === 0) return;
    if (!window.confirm(`Delete ${selectedRows.length} selected picture(s)? This cannot be undone.`)) return;
    setClearing(true);
    setErr("");
    try {
      await fetchJson(`/api/photos/bulk-delete`, {
        method: "POST",
        body: JSON.stringify({ items: selectedRows.map((r) => ({ reportId: r.reportId, filename: r.photo.filename })) })
      });
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setClearing(false);
    }
  }

  async function cleanupOld() {
    if (!isAdmin) return;
    if (!window.confirm("Delete all report photos older than 24 months now?")) return;
    setClearing(true);
    setErr("");
    try {
      const data = await fetchJson(`/api/photos/cleanup-old`, { method: "POST" });
      setCleanup(data.cleanup || null);
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setClearing(false);
    }
  }

  async function clearAll() {
    if (!isAdmin) return;
    if (!window.confirm("Clear ALL report photos? This cannot be undone.")) return;
    setClearing(true);
    setErr("");
    try {
      await fetchJson(`/api/photos/clear`, { method: "POST" });
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setClearing(false);
    }
  }

  function setAllSelected(checked) {
    if (!checked) return setSelected({});
    const next = {};
    rows.forEach((r) => { next[itemKey(r)] = true; });
    setSelected(next);
  }

  function goPage(next) {
    const p = Math.max(1, Math.min(totalPages, next));
    setPage(p);
    load({ page: p });
  }

  function renderCard(row, idx) {
    const key = itemKey(row);
    const busy = busyId === key;
    return (
      <Col key={key} xs={12} sm={6} md={4} xl={3} className="mb-3">
        <Card border="light" className="shadow-sm h-100">
          <div style={{ position: "relative", background: "#f8fafc", height: 220, overflow: "hidden", cursor: "pointer" }} onClick={() => setPreviewIndex(idx)}>
            {isAdmin ? (
              <Form.Check
                type="checkbox"
                checked={!!selected[key]}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const checked = !!e.target.checked;
                  setSelected((prev) => ({ ...prev, [key]: checked }));
                }}
                style={{ position: "absolute", top: 8, left: 10, zIndex: 2 }}
              />
            ) : null}
            <AuthImage src={row.photo.previewUrl || row.photo.url} alt={row.photo.filename} authHeaders={authHeaders} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <Card.Body className="p-3">
            <div className="fw-bold text-truncate" title={row.reportName}>{row.reportName || row.reportId}</div>
            <div className="small text-muted text-truncate" title={row.area}>{row.area || "No area"}</div>
            <div className="mt-2 d-flex flex-wrap" style={{ gap: 6 }}>
              {row.section ? <Badge bg="secondary">{row.section}</Badge> : null}
              {row.reportMonth ? <Badge bg="info">{row.reportMonth}</Badge> : null}
              {row.reportType ? <Badge bg="light" text="dark">{row.reportType}</Badge> : null}
            </div>
            <div className="small text-muted mt-2">{formatDate(row.photo.updatedAt)} · {formatBytes(row.photo.size)}</div>
            <div className="d-flex mt-3" style={{ gap: 8 }}>
              <Button size="sm" variant="outline-secondary" onClick={() => setPreviewIndex(idx)}>View</Button>
              {canDL ? <Button size="sm" variant="outline-primary" onClick={() => downloadPhoto(row)}>Download</Button> : null}
              {isAdmin ? <Button size="sm" variant="outline-danger" disabled={busy} onClick={() => deletePhoto(row)}>{busy ? "..." : "Delete"}</Button> : null}
            </div>
          </Card.Body>
        </Card>
      </Col>
    );
  }

  return (
    <div className="py-4">
      <Row className="align-items-start mb-3">
        <Col>
          <h4 className="mb-0">Pictures</h4>
          <div className="text-muted small">Report photos with section/month filters, gallery preview, bulk admin tools, and automatic 24-month cleanup.</div>
        </Col>
        <Col xs="auto" className="d-flex align-items-center flex-wrap" style={{ gap: 8 }}>
          <ButtonGroup size="sm">
            <Button variant={viewMode === "grid" ? "primary" : "outline-primary"} onClick={() => setViewMode("grid")}><FontAwesomeIcon icon={faTh} /></Button>
            <Button variant={viewMode === "list" ? "primary" : "outline-primary"} onClick={() => setViewMode("list")}><FontAwesomeIcon icon={faList} /></Button>
          </ButtonGroup>
          <Button variant="outline-secondary" size="sm" onClick={() => load()} disabled={loading}><FontAwesomeIcon icon={faSyncAlt} className="me-2" />Refresh</Button>
        </Col>
      </Row>

      {err ? <Alert variant="danger" className="mb-3">{err}</Alert> : null}
      {cleanup?.deleted ? <Alert variant="info" className="mb-3">Automatic cleanup removed {cleanup.deleted} photo(s) older than 24 months.</Alert> : null}

      <Card border="light" className="shadow-sm mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap align-items-center" style={{ gap: 8 }}>
            <Dropdown className="btn-toolbar">
              <Dropdown.Toggle as={Button} variant="outline-primary" size="sm"><FontAwesomeIcon icon={faFilter} className="me-2" />{getRangeLabel(range)}</Dropdown.Toggle>
              <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
                {RANGE_OPTIONS.map((v) => <Dropdown.Item key={v} active={v === range} onClick={() => setRange(v)}>{getRangeLabel(v)}</Dropdown.Item>)}
              </Dropdown.Menu>
            </Dropdown>
            {filterDropdown("Section", section, facets.sections, setSection, "All sections")}
            {filterDropdown("Month", month, facets.months, setMonth, "All months")}
            {filterDropdown("Area", area, facets.areas, setArea, "All areas")}
            {filterDropdown("Technician", technician, facets.technicians, setTechnician, "All techs")}
            {filterDropdown("Type", type, facets.types, setType, "All types")}
            <InputGroup size="sm" style={{ maxWidth: 360 }}>
              <InputGroup.Text><FontAwesomeIcon icon={faSearch} /></InputGroup.Text>
              <Form.Control placeholder="Search report, area, section, technician…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </InputGroup>
          </div>
        </Card.Body>
      </Card>

      <Card border="light" className="shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center flex-wrap mb-3" style={{ gap: 8 }}>
            <div className="text-muted">
              Total: <Badge bg="secondary">{total}</Badge> Page: <Badge bg="light" text="dark">{page}/{totalPages}</Badge>
              {loading ? <span className="ms-3"><Spinner animation="border" size="sm" /> Loading...</span> : null}
            </div>
            <div className="d-flex flex-wrap" style={{ gap: 8 }}>
              {isAdmin ? (
                <>
                  <Form.Check type="checkbox" label="Select page" checked={rows.length > 0 && rows.every((r) => selected[itemKey(r)])} onChange={(e) => setAllSelected(e.target.checked)} />
                  <Button variant="outline-danger" size="sm" disabled={selectedRows.length === 0 || clearing} onClick={bulkDelete}><FontAwesomeIcon icon={faTrash} className="me-2" />Delete selected ({selectedRows.length})</Button>
                  <Button variant="outline-warning" size="sm" disabled={clearing} onClick={cleanupOld}>Delete older than 24 months</Button>
                  <Button variant="outline-danger" size="sm" disabled={clearing} onClick={clearAll}>Clear All</Button>
                </>
              ) : null}
            </div>
          </div>

          {viewMode === "grid" ? (
            <Row>{rows.map(renderCard)}</Row>
          ) : (
            <div className="table-responsive">
              <table className="table table-centered table-nowrap mb-0 rounded">
                <thead className="thead-light"><tr><th>Picture</th><th>Report</th><th>Section</th><th>Area</th><th>Captured</th><th className="text-end">Actions</th></tr></thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const key = itemKey(r);
                    return <tr key={key}>
                      <td><AuthImage src={r.photo.previewUrl || r.photo.url} alt="" authHeaders={authHeaders} loading="lazy" style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 6, cursor: "pointer" }} onClick={() => setPreviewIndex(idx)} /></td>
                      <td><div className="fw-bold">{r.reportName || r.reportId}</div><div className="small text-muted">{r.photo.filename}</div></td>
                      <td>{r.section || "—"}<div className="small text-muted">{r.reportMonth || ""}</div></td>
                      <td>{r.area || "—"}<div className="small text-muted">{r.technician || ""}</div></td>
                      <td className="text-muted">{formatDate(r.photo.updatedAt)}</td>
                      <td className="text-end"><Button size="sm" variant="outline-secondary" className="me-2" onClick={() => setPreviewIndex(idx)}>View</Button>{canDL ? <Button size="sm" variant="outline-primary" className="me-2" onClick={() => downloadPhoto(r)}>Download</Button> : null}{isAdmin ? <Button size="sm" variant="outline-danger" onClick={() => deletePhoto(r)}>Delete</Button> : null}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows.length === 0 ? <div className="text-center text-muted py-4">No pictures found for this filter selection.</div> : null}

          <div className="d-flex justify-content-between align-items-center mt-3">
            <Button size="sm" variant="outline-secondary" disabled={page <= 1 || loading} onClick={() => goPage(page - 1)}>Previous</Button>
            <span className="text-muted small">Showing up to {PAGE_SIZE} per page</span>
            <Button size="sm" variant="outline-secondary" disabled={page >= totalPages || loading} onClick={() => goPage(page + 1)}>Next</Button>
          </div>
        </Card.Body>
      </Card>

      <Modal show={!!previewRow} onHide={() => setPreviewIndex(-1)} size="xl" centered>
        <Modal.Header closeButton><Modal.Title>{previewRow?.reportName || previewRow?.photo?.filename || "Picture"}</Modal.Title></Modal.Header>
        <Modal.Body>
          {previewRow ? <Row>
            <Col lg={8} className="mb-3 mb-lg-0"><AuthImage src={previewRow.photo.previewUrl || previewRow.photo.url} alt={previewRow.photo.filename} authHeaders={authHeaders} loading="eager" style={{ width: "100%", maxHeight: "70vh", minHeight: 260, objectFit: "contain", background: "#111", borderRadius: 8 }} /></Col>
            <Col lg={4}>
              <div className="mb-2"><strong>Section:</strong> {previewRow.section || "—"}</div>
              <div className="mb-2"><strong>Month:</strong> {previewRow.reportMonth || "—"}</div>
              <div className="mb-2"><strong>Area:</strong> {previewRow.area || "—"}</div>
              <div className="mb-2"><strong>Technician:</strong> {previewRow.technician || "—"}</div>
              <div className="mb-2"><strong>Service:</strong> {previewRow.service || "—"}</div>
              <div className="mb-2"><strong>Captured:</strong> {formatDate(previewRow.photo.updatedAt)}</div>
              <div className="mb-2"><strong>File:</strong> <span className="text-break">{previewRow.photo.filename}</span></div>
              <div className="d-flex flex-wrap mt-3" style={{ gap: 8 }}>
                <Button variant="outline-secondary" disabled={previewIndex <= 0} onClick={() => setPreviewIndex(previewIndex - 1)}>Previous</Button>
                <Button variant="outline-secondary" disabled={previewIndex >= rows.length - 1} onClick={() => setPreviewIndex(previewIndex + 1)}>Next</Button>
                {canDL ? <Button variant="outline-primary" onClick={() => downloadPhoto(previewRow)}><FontAwesomeIcon icon={faDownload} className="me-2" />Download</Button> : null}
              </div>
            </Col>
          </Row> : null}
        </Modal.Body>
      </Modal>
    </div>
  );
}
