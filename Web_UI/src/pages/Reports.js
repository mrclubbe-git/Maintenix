import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Col,
  Row,
  Card,
  Table,
  Badge,
  Button,
  Dropdown,
  ButtonGroup,
  Form,
  Alert,
  Spinner,
  InputGroup
} from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faFilter, faSearch, faSyncAlt, faEye, faTrash } from "@fortawesome/free-solid-svg-icons";

const RANGE = {
  ALL: "all",
  TODAY: "today",
  PAST_7_DAYS: "past_7_days",
  LAST_MONTH: "last_month",
  YTD: "ytd"
};

const STATUS = {
  ALL: "ALL",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  DENIED: "DENIED"
};

const STATUS_LABEL = {
  [STATUS.ALL]: "All",
  [STATUS.PENDING]: "Pending",
  [STATUS.APPROVED]: "Approved",
  [STATUS.DENIED]: "Rejected"
};

const RANGE_LABEL = {
  [RANGE.ALL]: "All",
  [RANGE.TODAY]: "Today",
  [RANGE.PAST_7_DAYS]: "Past 7 days",
  [RANGE.LAST_MONTH]: "Last month",
  [RANGE.YTD]: "Year to date"
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}
function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function startOfLastMonth(now) {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
}
function endOfLastMonth(now) {
  return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
}
function getRangeWindow(rangeKey) {
  const now = new Date();
  if (rangeKey === RANGE.ALL) return null;
  if (rangeKey === RANGE.TODAY) return { from: startOfDay(now), to: endOfDay(now) };
  if (rangeKey === RANGE.PAST_7_DAYS) return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) };
  if (rangeKey === RANGE.LAST_MONTH) return { from: startOfLastMonth(now), to: endOfLastMonth(now) };
  if (rangeKey === RANGE.YTD) return { from: startOfYear(now), to: endOfDay(now) };
  return null;
}

function formatDateTime(d) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function readNotifications() {
  const raw = safeJsonParse(localStorage.getItem("appNotifications") || "[]", []);
  return Array.isArray(raw) ? raw : [];
}

function writeNotifications(items) {
  localStorage.setItem("appNotifications", JSON.stringify(Array.isArray(items) ? items : []));
  window.dispatchEvent(new Event("notificationsUpdated"));
}

function makeNotificationId() {
  return `notif_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function extractTargetUserEmail(reportRow) {
  return String(reportRow?.owner?.email || reportRow?.ownerEmail || "").trim().toLowerCase();
}

function addUserSpecificRejectedNotification(reportRow, reportDisplayName) {
  const userEmail = extractTargetUserEmail(reportRow);
  if (!userEmail) return false;

  const message = `"${String(reportDisplayName || reportRow?.fileName || "Report").trim()}" rejected`;
  const items = readNotifications();

  items.unshift({
    id: makeNotificationId(),
    type: "report_rejected",
    message,
    createdAt: new Date().toISOString(),
    global: false,
    userEmail,
    readBy: []
  });

  writeNotifications(items);
  return true;
}

function sanitizeFileName(name) {
  return String(name || "report")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getMonthFolderFromDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown-Month";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function triggerBrowserDownload(blob, fileName) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function Reports() {
  const authToken = localStorage.getItem("authToken") || "";
  const authUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);

  const roleKey = String(authUser?.role || "").toUpperCase().replace(/\s+/g, "");
  const canModerate = roleKey === "ADMIN" || roleKey === "L2" || roleKey === "LEVEL2" || roleKey === "LEVEL_2";
  const canDelete = roleKey === "ADMIN";

  const [range, setRange] = useState(RANGE.ALL);
  const [statusFilter, setStatusFilter] = useState(STATUS.ALL);
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [err, setErr] = useState("");
  const [reports, setReports] = useState([]);

  const [displayNameMap, setDisplayNameMap] = useState({});

  const [updatingName, setUpdatingName] = useState("");
  const [viewingName, setViewingName] = useState("");

  const windowRange = useMemo(() => getRangeWindow(range), [range]);

  function extractServicingReportIdFromStoredName(fileName) {
    const base = String(fileName || "");
    const m = base.match(/^Service_Report_(svc_\d+_[0-9a-f]+)\.docx$/i);
    return m ? m[1] : "";
  }

  const getDisplayNameForRow = useCallback(
    (r) => {
      const stored = String(r?.fileName || "");
      const mapped = displayNameMap[stored];
      return mapped || stored;
    },
    [displayNameMap]
  );

  async function resolveServicingDisplayNames(list) {
    if (!authToken) return;

    const pairs = (Array.isArray(list) ? list : [])
      .map((r) => {
        const stored = String(r?.fileName || "");
        const reportId = extractServicingReportIdFromStoredName(stored);
        return reportId ? { stored, reportId } : null;
      })
      .filter(Boolean);

    if (pairs.length === 0) return;

    const toFetch = pairs.filter((p) => !displayNameMap[p.stored]);
    if (toFetch.length === 0) return;

    const concurrency = 6;
    const nextMap = {};

    for (let i = 0; i < toFetch.length; i += concurrency) {
      const batch = toFetch.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async ({ stored, reportId }) => {
          try {
            const res = await fetch(`/api/servicing/status/${encodeURIComponent(reportId)}`, {
              headers: { Authorization: `Bearer ${authToken}` }
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data) return { stored, display: "" };

            const display = String(data?.serverFileName || data?.result?.fileName || "").trim();
            return { stored, display };
          } catch {
            return { stored, display: "" };
          }
        })
      );

      for (const r of results) {
        if (r?.display) nextMap[r.stored] = r.display;
      }
    }

    if (Object.keys(nextMap).length > 0) {
      setDisplayNameMap((prev) => ({ ...prev, ...nextMap }));
    }
  }

  async function loadReports({ isManual = false } = {}) {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      setReports([]);
      return;
    }

    if (isManual) setRefreshing(true);
    else setLoading(true);

    setErr("");
    try {
      const res = await fetch("/api/reports", {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Failed to load reports (HTTP ${res.status}).`);
        setReports([]);
        return;
      }

      const list = Array.isArray(data.reports) ? data.reports : [];
      setReports(list);
      resolveServicingDisplayNames(list);
    } catch {
      setErr("Failed to load reports (API not reachable).");
      setReports([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function approveReport(fileName) {
    if (!authToken) return;
    setUpdatingName(fileName);
    setErr("");
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(fileName)}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data?.message || `Approve failed (HTTP ${res.status}).`);
    } catch {
      setErr("Approve failed (API not reachable).");
    } finally {
      setUpdatingName("");
      loadReports({ isManual: true });
    }
  }

  async function denyReport(fileName) {
    if (!authToken) return;
    setUpdatingName(fileName);
    setErr("");
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(fileName)}/deny`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Not approved failed (HTTP ${res.status}).`);
      } else {
        const reportRow = reports.find((r) => String(r?.fileName || "") === String(fileName || ""));
        const reportDisplayName = reportRow ? getDisplayNameForRow(reportRow) : fileName;
        addUserSpecificRejectedNotification(reportRow, reportDisplayName);
      }
    } catch {
      setErr("Not approved failed (API not reachable).");
    } finally {
      setUpdatingName("");
      loadReports({ isManual: true });
    }
  }

  async function deleteReport(fileName, displayName) {
    if (!authToken) return;
    if (!canDelete) return;

    const shownName = String(displayName || "").trim() || String(fileName || "").trim();
    const alsoShowStored = shownName !== fileName ? `\n\nStored as:\n${fileName}` : "";

    const ok = window.confirm(
      `Delete this report?\n\n${shownName}${alsoShowStored}\n\nThis will remove the file from the server (cannot be undone).`
    );
    if (!ok) return;

    setUpdatingName(fileName);
    setErr("");

    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Delete failed (HTTP ${res.status}).`);
      } else {
        setReports((prev) => prev.filter((r) => r.fileName !== fileName));
      }
    } catch {
      setErr("Delete failed (API not reachable).");
    } finally {
      setUpdatingName("");
      loadReports({ isManual: true });
    }
  }

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  const filteredReports = useMemo(() => {
    const from = windowRange?.from?.getTime?.() ?? null;
    const to = windowRange?.to?.getTime?.() ?? null;
    const q = String(search || "").trim().toLowerCase();
    const want = String(statusFilter || "ALL").toUpperCase();

    return reports
      .filter((r) => {
        if (from !== null && to !== null) {
          const t = Date.parse(r.createdAt);
          const inRange = !Number.isNaN(t) && t >= from && t <= to;
          if (!inRange) return false;
        }

        if (want !== "ALL") {
          const s = String(r.status || "").toUpperCase();
          if (s !== want) return false;
        }

        if (!q) return true;
        const stored = String(r.fileName || "").toLowerCase();
        const display = String(getDisplayNameForRow(r) || "").toLowerCase();
        return stored.includes(q) || display.includes(q);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [reports, windowRange, statusFilter, search, getDisplayNameForRow]);

  const summary = useMemo(() => {
    const total = filteredReports.length;
    const approved = filteredReports.filter((r) => String(r.status || "").toUpperCase() === "APPROVED").length;
    const pending = filteredReports.filter((r) => String(r.status || "").toUpperCase() === "PENDING").length;
    const denied = filteredReports.filter((r) => String(r.status || "").toUpperCase() === "DENIED").length;
    return { total, approved, pending, denied };
  }, [filteredReports]);

  function approvalLabel(status) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return "Approved";
    if (s === "DENIED") return "Rejected";
    return "Pending";
  }

  function approvalVariant(status) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return "success";
    if (s === "DENIED") return "danger";
    return "warning";
  }

  async function fetchReportBlob(fileName) {
    const res = await fetch(`/api/reports/file/${encodeURIComponent(fileName)}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.message || `Download failed for ${fileName} (HTTP ${res.status}).`);
    }

    return res.blob();
  }

  async function downloadReport(fileName, downloadName) {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }

    setErr("");
    try {
      const blob = await fetchReportBlob(fileName);
      triggerBrowserDownload(blob, downloadName || fileName);
    } catch (error) {
      setErr(error?.message || "Download failed (API not reachable).");
    }
  }

  async function downloadApprovedAndPendingZip() {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }

    const rows = reports.filter((r) => {
      const s = String(r?.status || "").toUpperCase();
      return s === "APPROVED" || s === "PENDING";
    });

    if (rows.length === 0) {
      setErr("No Approved or Pending reports were found.");
      return;
    }

    setBulkDownloading(true);
    setErr("");

    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      for (const row of rows) {
        const statusKey = String(row?.status || "").toUpperCase();
        const statusFolder = statusKey === "APPROVED" ? "Approved" : "Pending";
        const monthFolder = getMonthFolderFromDate(row?.createdAt);
        const displayName = sanitizeFileName(getDisplayNameForRow(row) || row?.fileName || "report");

        const blob = await fetchReportBlob(row.fileName);

        const monthZipFolder = zip.folder(monthFolder);
        const statusZipFolder = monthZipFolder.folder(statusFolder);
        statusZipFolder.file(displayName, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerBrowserDownload(zipBlob, `reports_by_month_${stamp}.zip`);
    } catch (error) {
      setErr(error?.message || "Bulk download failed.");
    } finally {
      setBulkDownloading(false);
    }
  }

  async function viewReport(fileName) {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }

    if (viewingName) return;
    setViewingName(fileName);

    setErr("");
    try {
      const lower = String(fileName || "").toLowerCase();
      const url = lower.endsWith(".docx")
        ? `/api/reports/view/${encodeURIComponent(fileName)}`
        : `/api/reports/file/${encodeURIComponent(fileName)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.message || `View failed (HTTP ${res.status}).`);
        setViewingName("");
        return;
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      window.open(blobUrl, "_blank", "noopener,noreferrer");

      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
      setViewingName("");
    } catch {
      setErr("View failed (API not reachable).");
      setViewingName("");
    }
  }

  const emptyColSpan = 4;

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div>
          <h4 className="mb-0">Reports</h4>
          <small className="text-muted">
            Server folder: <span className="fw-bold">data/uploads/reports</span>
          </small>
        </div>

        <ButtonGroup>
          <Dropdown className="btn-toolbar me-2">
            <Dropdown.Toggle as={Button} variant="outline-primary" size="sm">
              <FontAwesomeIcon icon={faFilter} className="me-2" />
              {RANGE_LABEL[range]}
            </Dropdown.Toggle>
            <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
              {Object.values(RANGE).map((key) => (
                <Dropdown.Item key={key} active={key === range} onClick={() => setRange(key)}>
                  {RANGE_LABEL[key]}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>

          <Dropdown className="btn-toolbar">
            <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm">
              Status: {STATUS_LABEL[statusFilter]}
            </Dropdown.Toggle>
            <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
              {Object.values(STATUS).map((key) => (
                <Dropdown.Item key={key} active={key === statusFilter} onClick={() => setStatusFilter(key)}>
                  {STATUS_LABEL[key]}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </ButtonGroup>
      </div>

      {err ? <Alert variant="danger">{err}</Alert> : null}

      <Row className="mb-4">
        <Col xs={12} md={3} className="mb-3 mb-md-0">
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Reports found</div>
              <div className="h3 mb-0">{summary.total}</div>
              <small className="text-muted">
                {windowRange ? (
                  <>
                    {formatDateTime(windowRange.from)} – {formatDateTime(windowRange.to)}
                  </>
                ) : (
                  "All dates"
                )}
              </small>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} md={3} className="mb-3 mb-md-0">
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Approved</div>
              <div className="h3 mb-0">{summary.approved}</div>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} md={3} className="mb-3 mb-md-0">
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Pending</div>
              <div className="h3 mb-0">{summary.pending}</div>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} md={3}>
          <Card border="light" className="shadow-sm">
            <Card.Body>
              <div className="text-muted">Rejected</div>
              <div className="h3 mb-0">{summary.denied}</div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card border="light" className="shadow-sm">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap" style={{ gap: 8 }}>
              <h5 className="mb-0">Report Files</h5>

              <div
                className="reports-header-actions d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center"
                style={{ gap: 8 }}
              >
                <div style={{ width: "min(520px, 100%)" }}>
                  <InputGroup size="sm" style={{ width: "100%" }}>
                    <InputGroup.Text>
                      <FontAwesomeIcon icon={faSearch} />
                    </InputGroup.Text>
                    <Form.Control
                      placeholder="Search filename…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      disabled={loading || refreshing || bulkDownloading}
                    />
                  </InputGroup>
                </div>

                <Button
                  variant="outline-success"
                  size="sm"
                  onClick={downloadApprovedAndPendingZip}
                  disabled={loading || refreshing || bulkDownloading}
                  title="Download all Approved and Pending reports into month folders"
                  style={{ width: "min(100%, 280px)" }}
                >
                  {bulkDownloading ? (
                    <>
                      <Spinner size="sm" className="me-2" />
                      Building ZIP…
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faDownload} className="me-2" />
                      Download Approved + Pending ZIP
                    </>
                  )}
                </Button>

                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => loadReports({ isManual: true })}
                  disabled={loading || refreshing || bulkDownloading}
                  title="Refresh list"
                  style={{ width: "min(100%, 160px)" }}
                >
                  <FontAwesomeIcon icon={faSyncAlt} className="me-2" />
                  {refreshing ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
            </Card.Header>

            <Card.Body className="p-0">
              {loading ? (
                <div className="p-3 text-muted">
                  <Spinner size="sm" className="me-2" /> Loading reports…
                </div>
              ) : null}

              <Table responsive className="table-centered table-nowrap mb-0 rounded">
                <thead className="thead-light">
                  <tr>
                    <th className="border-0">Report</th>
                    <th className="border-0">Date</th>
                    <th className="border-0">Approval status</th>
                    <th className="border-0 text-end">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredReports.length === 0 ? (
                    <tr>
                      <td colSpan={emptyColSpan} className="text-center text-muted py-4">
                        No reports found for this filter selection.
                      </td>
                    </tr>
                  ) : (
                    filteredReports.map((r) => {
                      const statusKey = String(r.status || "").toUpperCase();
                      const busy = updatingName === r.fileName;
                      const isViewingThis = viewingName === r.fileName;

                      return (
                        <tr key={r.fileName}>
                          <td className="fw-bold" title={r.fileName}>
                            {getDisplayNameForRow(r)}
                          </td>
                          <td>{formatDateTime(new Date(r.createdAt))}</td>

                          <td>
                            {canModerate ? (
                              <Dropdown as={ButtonGroup} size="sm">
                                <Button variant={approvalVariant(r.status)} disabled={busy || bulkDownloading}>
                                  {approvalLabel(r.status)}
                                </Button>
                                <Dropdown.Toggle split variant={approvalVariant(r.status)} disabled={busy || bulkDownloading} />
                                <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
                                  <Dropdown.Item
                                    disabled={statusKey === "APPROVED"}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      approveReport(r.fileName);
                                    }}
                                  >
                                    <span role="img" aria-label="approve" className="me-2">
                                      ✅
                                    </span>
                                    Approve
                                  </Dropdown.Item>

                                  <Dropdown.Item
                                    disabled={statusKey === "DENIED"}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      denyReport(r.fileName);
                                    }}
                                  >
                                    <span role="img" aria-label="reject" className="me-2">
                                      ❌
                                    </span>
                                    Reject
                                  </Dropdown.Item>
                                </Dropdown.Menu>
                              </Dropdown>
                            ) : (
                              <Badge bg={approvalVariant(r.status)}>{approvalLabel(r.status)}</Badge>
                            )}

                            {busy ? (
                              <span className="ms-2 text-muted">
                                <Spinner size="sm" className="me-1" />
                                Updating…
                              </span>
                            ) : null}
                          </td>

                          <td className="text-end">
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              className="me-2"
                              title="View"
                              disabled={!!viewingName || bulkDownloading}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                viewReport(r.fileName);
                              }}
                            >
                              {isViewingThis ? (
                                <>
                                  <Spinner size="sm" className="me-2" />
                                  Generating…
                                </>
                              ) : (
                                <>
                                  <FontAwesomeIcon icon={faEye} className="me-2" />
                                  View
                                </>
                              )}
                            </Button>

                            {canDelete ? (
                              <Button
                                variant="outline-danger"
                                size="sm"
                                className="me-2"
                                title="Delete (Admin only)"
                                disabled={busy || isViewingThis || bulkDownloading}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  deleteReport(r.fileName, getDisplayNameForRow(r));
                                }}
                              >
                                <FontAwesomeIcon icon={faTrash} className="me-2" />
                                Delete
                              </Button>
                            ) : null}

                            <Button
                              variant="outline-primary"
                              size="sm"
                              title="Download"
                              disabled={isViewingThis || bulkDownloading}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                downloadReport(r.fileName, getDisplayNameForRow(r));
                              }}
                            >
                              <FontAwesomeIcon icon={faDownload} className="me-2" />
                              Download
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </Table>

              <div className="p-3 text-muted small">
                Logged in as: <span className="fw-bold">{authUser?.email || "unknown"}</span>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}