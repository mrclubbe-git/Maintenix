import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Col,
  Row,
  Card,
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
import { faDownload, faFileArchive, faFilter, faSearch, faSyncAlt, faEye, faTrash } from "@fortawesome/free-solid-svg-icons";

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

const REPORT_TYPE = {
  ALL: "ALL",
  CALLOUT: "CALLOUT",
  SERVICING: "SERVICING"
};

const REPORT_TYPE_LABEL = {
  [REPORT_TYPE.ALL]: "All Reports",
  [REPORT_TYPE.CALLOUT]: "Callout Reports",
  [REPORT_TYPE.SERVICING]: "Service Reports"
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

function getReportTypeForRow(reportRow) {
  const explicitType = String(reportRow?.reportType || reportRow?.type || "").trim().toUpperCase();
  if (explicitType === REPORT_TYPE.SERVICING || explicitType === "SERVICE") return REPORT_TYPE.SERVICING;
  if (explicitType === REPORT_TYPE.CALLOUT || explicitType === "CALL_OUT" || explicitType === "CALL-OUT") return REPORT_TYPE.CALLOUT;

  const fileName = String(reportRow?.fileName || "").trim();
  if (/^Service_Report_/i.test(fileName)) return REPORT_TYPE.SERVICING;
  if (/^callout(?:_|-|\b)/i.test(fileName) || /^(?:CallOut|Callout|Call_Out|Call-Out)_Report_/i.test(fileName)) {
    return REPORT_TYPE.CALLOUT;
  }

  return "UNKNOWN";
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

export default function Reports() {
  const authToken = localStorage.getItem("authToken") || "";
  const authUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);

  const roleKey = String(authUser?.role || "").toUpperCase().replace(/\s+/g, "");
  const canModerate = roleKey === "ADMIN" || roleKey === "L2" || roleKey === "LEVEL2" || roleKey === "LEVEL_2";
  const canDelete = roleKey === "ADMIN";
  const canDownloadZip = roleKey === "ADMIN" || roleKey === "L3" || roleKey === "LEVEL3" || roleKey === "LEVEL_3";

  const [range, setRange] = useState(RANGE.ALL);
  const [statusFilter, setStatusFilter] = useState(STATUS.ALL);
  const [reportTypeFilter, setReportTypeFilter] = useState(REPORT_TYPE.ALL);
  const [sectionFilter, setSectionFilter] = useState("ALL");
  const [monthFilter, setMonthFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [reports, setReports] = useState([]);

  const [displayNameMap, setDisplayNameMap] = useState({});

  const [updatingName, setUpdatingName] = useState("");
  const [viewingName, setViewingName] = useState("");
  const [zipDownloading, setZipDownloading] = useState(false);

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
      return mapped || String(r?.displayFileName || "") || stored;
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
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Approved by reviewer." })
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
    const reason = String(window.prompt("Reason for rejecting this report?") || "").trim();
    if (!reason) {
      setErr("Reject reason is required.");
      return;
    }
    setUpdatingName(fileName);
    setErr("");
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(fileName)}/deny`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
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

  const sectionOptions = useMemo(() => {
    return Array.from(new Set(reports.map((r) => String(r.section || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [reports]);

  const monthOptions = useMemo(() => {
    return Array.from(new Set(reports.map((r) => String(r.reportMonth || "").trim()).filter(Boolean))).sort((a, b) =>
      b.localeCompare(a)
    );
  }, [reports]);

  const filteredReports = useMemo(() => {
    const from = windowRange?.from?.getTime?.() ?? null;
    const to = windowRange?.to?.getTime?.() ?? null;
    const q = String(search || "").trim().toLowerCase();
    const want = String(statusFilter || "ALL").toUpperCase();
    const wantType = String(reportTypeFilter || REPORT_TYPE.ALL).toUpperCase();
    const wantSection = String(sectionFilter || "ALL");
    const wantMonth = String(monthFilter || "ALL");

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

        if (wantType !== REPORT_TYPE.ALL && getReportTypeForRow(r) !== wantType) return false;

        if (wantSection !== "ALL" && String(r.section || "") !== wantSection) return false;
        if (wantMonth !== "ALL" && String(r.reportMonth || "") !== wantMonth) return false;

        if (!q) return true;
        const stored = String(r.fileName || "").toLowerCase();
        const display = String(getDisplayNameForRow(r) || "").toLowerCase();
        const section = String(r.section || "").toLowerCase();
        const month = String(r.reportMonth || "").toLowerCase();
        const area = String(r.area || "").toLowerCase();
        return stored.includes(q) || display.includes(q) || section.includes(q) || month.includes(q) || area.includes(q);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [reports, windowRange, statusFilter, reportTypeFilter, sectionFilter, monthFilter, search, getDisplayNameForRow]);

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

  function decisionSummary(reportRow) {
    const decision = reportRow?.approvalDecision || {};
    const reason = String(decision.reason || reportRow?.rejectionReason || "").trim();
    const who = String(decision.decidedByName || decision.decidedByEmail || decision.decidedBy || "").trim();
    const when = decision.at ? formatDateTime(new Date(decision.at)) : "";
    return { reason, who, when, source: String(decision.source || "").trim() };
  }

  function correctionPath(reportRow) {
    const type = getReportTypeForRow(reportRow);
    const base = type === REPORT_TYPE.CALLOUT ? "/CallOut" : "/Servicing";
    const params = new URLSearchParams();
    params.set("correctionOf", String(reportRow?.fileName || ""));
    const reason = String(reportRow?.approvalDecision?.reason || reportRow?.rejectionReason || "").trim();
    if (reason) params.set("reason", reason);
    return `${base}?${params.toString()}`;
  }

  function startCorrection(reportRow) {
    window.location.hash = correctionPath(reportRow);
  }

  async function downloadReport(fileName, downloadName) {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }

    setErr("");
    try {
      const res = await fetch(`/api/reports/file/${encodeURIComponent(fileName)}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.message || `Download failed (HTTP ${res.status}).`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName || fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setErr("Download failed (API not reachable).");
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

  async function downloadFilteredZip() {
    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }
    if (!canDownloadZip) return;
    if (filteredReports.length === 0) {
      setErr("No reports match the active filters, so there is nothing to ZIP.");
      return;
    }

    setZipDownloading(true);
    setErr("");
    try {
      const files = filteredReports.map((r) => String(r.fileName || "")).filter(Boolean);
      const res = await fetch("/api/reports/zip", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.message || `ZIP download failed (HTTP ${res.status}).`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `maintenix-reports-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setErr("ZIP download failed (API not reachable).");
    } finally {
      setZipDownloading(false);
    }
  }

  return (
    <>
      <div className="d-flex flex-column flex-lg-row justify-content-between align-items-stretch align-items-lg-center py-4" style={{ gap: 12 }}>
        <div>
          <h4 className="mb-0">Reports</h4>
          <small className="text-muted">
            Server folder: <span className="fw-bold">data/uploads/reports/&lt;section&gt;/&lt;month&gt;</span>
          </small>
        </div>

        <div className="reports-filter-actions">
          <Dropdown className="btn-toolbar reports-filter-control">
            <Dropdown.Toggle as={Button} variant="outline-primary" size="sm" className="w-100">
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

          <Dropdown className="btn-toolbar reports-filter-control">
            <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm" className="w-100">
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

          <Dropdown className="btn-toolbar reports-filter-control">
            <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm" className="w-100">
              {REPORT_TYPE_LABEL[reportTypeFilter]}
            </Dropdown.Toggle>
            <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
              {Object.values(REPORT_TYPE).map((key) => (
                <Dropdown.Item key={key} active={key === reportTypeFilter} onClick={() => setReportTypeFilter(key)}>
                  {REPORT_TYPE_LABEL[key]}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>

          <Dropdown className="btn-toolbar reports-filter-control">
            <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm" className="w-100 text-truncate">
              Section: {sectionFilter === "ALL" ? "All" : sectionFilter}
            </Dropdown.Toggle>
            <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
              <Dropdown.Item active={sectionFilter === "ALL"} onClick={() => setSectionFilter("ALL")}>
                All sections
              </Dropdown.Item>
              {sectionOptions.map((section) => (
                <Dropdown.Item key={section} active={section === sectionFilter} onClick={() => setSectionFilter(section)}>
                  {section}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>

          <Dropdown className="btn-toolbar reports-filter-control">
            <Dropdown.Toggle as={Button} variant="outline-secondary" size="sm" className="w-100">
              Month: {monthFilter === "ALL" ? "All" : monthFilter}
            </Dropdown.Toggle>
            <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
              <Dropdown.Item active={monthFilter === "ALL"} onClick={() => setMonthFilter("ALL")}>
                All months
              </Dropdown.Item>
              {monthOptions.map((month) => (
                <Dropdown.Item key={month} active={month === monthFilter} onClick={() => setMonthFilter(month)}>
                  {month}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </div>
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
            <Card.Header className="d-flex flex-column flex-lg-row justify-content-between align-items-stretch align-items-lg-center" style={{ gap: 10 }}>
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
                      placeholder="Search filename, section, month, or area…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      disabled={loading || refreshing}
                    />
                  </InputGroup>
                </div>

                {canDownloadZip ? (
                  <Button
                    variant="outline-success"
                    size="sm"
                    onClick={downloadFilteredZip}
                    disabled={loading || refreshing || zipDownloading || filteredReports.length === 0}
                    title="Download currently filtered reports as a ZIP with section/month folders"
                    style={{ width: "min(100%, 190px)" }}
                  >
                    <FontAwesomeIcon icon={faFileArchive} className="me-2" />
                    {zipDownloading ? "Preparing ZIP…" : `Download ZIP (${filteredReports.length})`}
                  </Button>
                ) : null}

                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => loadReports({ isManual: true })}
                  disabled={loading || refreshing}
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

              <div className="p-3">
                {filteredReports.length === 0 ? (
                  <div className="text-center text-muted py-4">No reports found for this filter selection.</div>
                ) : (
                  <Row className="g-3">
                    {filteredReports.map((r) => {
                      const statusKey = String(r.status || "").toUpperCase();
                      const busy = updatingName === r.fileName;
                      const isViewingThis = viewingName === r.fileName;
                      const decision = decisionSummary(r);

                      return (
                        <Col key={r.fileName} xs={12}>
                          <Card border="light" className="shadow-sm h-100">
                            <Card.Body>
                              <div className="d-flex justify-content-between align-items-start flex-wrap" style={{ gap: 10 }}>
                                <div style={{ minWidth: 0, flex: "1 1 280px" }}>
                                  <div className="fw-bold text-break" title={r.fileName}>{getDisplayNameForRow(r)}</div>
                                  <div className="d-flex flex-wrap mt-2" style={{ gap: 6 }}>
                                    <Badge bg="secondary">{r.section || "No section"}</Badge>
                                    {decision.source ? <Badge bg="light" text="dark">Decision: {decision.source}</Badge> : null}
                                    {r.correctionOfReport ? <Badge bg="info">Correction</Badge> : null}
                                  </div>
                                  {r.correctionOfReport ? (
                                    <div className="mt-2 small text-muted text-break">
                                      Corrects: {r.correctionOfReport}
                                    </div>
                                  ) : null}
                                  {(decision.when || decision.who || decision.reason) ? (
                                    <div className="mt-2 small text-muted">
                                      {decision.when || decision.who ? (
                                        <div>
                                          Last decision{decision.who ? ` by ${decision.who}` : ""}{decision.when ? ` on ${decision.when}` : ""}
                                        </div>
                                      ) : null}
                                      {decision.reason ? <div className="text-break">Reason: {decision.reason}</div> : null}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="text-muted small text-end" style={{ flex: "0 0 auto" }}>
                                  {formatDateTime(new Date(r.createdAt))}
                                </div>
                              </div>

                              <div className="d-flex justify-content-between align-items-center flex-wrap mt-3" style={{ gap: 8 }}>
                                <div>
                                  {canModerate ? (
                                    <Dropdown as={ButtonGroup} size="sm">
                                      <Button variant={approvalVariant(r.status)} disabled={busy}>{approvalLabel(r.status)}</Button>
                                      <Dropdown.Toggle split variant={approvalVariant(r.status)} disabled={busy} />
                                      <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end">
                                        <Dropdown.Item disabled={statusKey === "APPROVED"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); approveReport(r.fileName); }}>
                                          <span role="img" aria-label="approve" className="me-2">✅</span>Approve
                                        </Dropdown.Item>
                                        <Dropdown.Item disabled={statusKey === "DENIED"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); denyReport(r.fileName); }}>
                                          <span role="img" aria-label="reject" className="me-2">❌</span>Reject
                                        </Dropdown.Item>
                                      </Dropdown.Menu>
                                    </Dropdown>
                                  ) : null}
                                  {busy ? <span className="ms-2 text-muted small"><Spinner size="sm" className="me-1" />Updating…</span> : null}
                                </div>

                                <div className="d-flex flex-wrap justify-content-end" style={{ gap: 8 }}>
                                  <Button variant="outline-secondary" size="sm" title="View" disabled={!!viewingName} onClick={(e) => { e.preventDefault(); e.stopPropagation(); viewReport(r.fileName); }}>
                                    {isViewingThis ? <><Spinner size="sm" className="me-2" />Generating…</> : <><FontAwesomeIcon icon={faEye} className="me-2" />View</>}
                                  </Button>
                                  <Button variant="outline-primary" size="sm" title="Download" disabled={isViewingThis} onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadReport(r.fileName, getDisplayNameForRow(r)); }}>
                                    <FontAwesomeIcon icon={faDownload} className="me-2" />Download
                                  </Button>
                                  {statusKey === "DENIED" ? (
                                    <Button variant="outline-warning" size="sm" title="Create corrected follow-up" disabled={busy || isViewingThis} onClick={(e) => { e.preventDefault(); e.stopPropagation(); startCorrection(r); }}>
                                      <FontAwesomeIcon icon={faSyncAlt} className="me-2" />Correct
                                    </Button>
                                  ) : null}
                                  {canDelete ? (
                                    <Button variant="outline-danger" size="sm" title="Delete (Admin only)" disabled={busy || isViewingThis} onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteReport(r.fileName, getDisplayNameForRow(r)); }}>
                                      <FontAwesomeIcon icon={faTrash} className="me-2" />Delete
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                )}
              </div>

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
