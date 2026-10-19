import { orgLocalStorage } from "../../config/organization";
import React, { useEffect, useState } from "react";
import { Col, Row, Card, Table, Badge, Alert } from "@themesberg/react-bootstrap";

// ---------------------------
// Helpers (no external libs)
// ---------------------------
function timeAgo(isoString) {
  if (!isoString) return "-";
  const ts = Date.parse(isoString);
  if (Number.isNaN(ts)) return "-";

  const diffSeconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  const units = [
    { name: "year", seconds: 60 * 60 * 24 * 365 },
    { name: "month", seconds: 60 * 60 * 24 * 30 },
    { name: "day", seconds: 60 * 60 * 24 },
    { name: "hour", seconds: 60 * 60 },
    { name: "minute", seconds: 60 },
    { name: "second", seconds: 1 }
  ];

  const rtf =
    typeof Intl !== "undefined" && Intl.RelativeTimeFormat
      ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
      : null;

  for (const u of units) {
    const v = Math.floor(diffSeconds / u.seconds);
    if (v >= 1) return rtf ? rtf.format(-v, u.name) : `${v} ${u.name}${v === 1 ? "" : "s"} ago`;
  }
  return "Just now";
}

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function currentMonthKey(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function reportMonthKey(report) {
  const explicit = String(report?.reportMonth || "").trim();
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;

  const created = new Date(report?.createdAt || "");
  return Number.isNaN(created.getTime()) ? "" : currentMonthKey(created);
}

function reportTypeForRow(report) {
  const explicit = String(report?.reportType || report?.type || "").trim().toUpperCase();
  if (explicit === "SERVICING" || explicit === "SERVICE") return "SERVICING";
  if (explicit === "CALLOUT" || explicit === "CALL_OUT" || explicit === "CALL-OUT") return "CALLOUT";

  const fileName = String(report?.displayFileName || report?.fileName || "").trim();
  if (/^Service_Report_/i.test(fileName)) return "SERVICING";
  if (/^(?:CallOut|Callout|Call_Out|Call-Out)_Report_/i.test(fileName) || /^callout(?:_|-|\b)/i.test(fileName)) {
    return "CALLOUT";
  }
  return "UNKNOWN";
}

function currentMonthLabel() {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date());
  } catch {
    return currentMonthKey();
  }
}

function latestReportLabel(report) {
  if (!report?.createdAt) return "No reports yet this month";
  const when = new Date(report.createdAt);
  if (Number.isNaN(when.getTime())) return "Report generated this month";
  return `Latest ${timeAgo(report.createdAt)}`;
}

function MonthlyReportTracker({ title, count, latestReport, loading, error, noun }) {
  return (
    <Card border="light" className="shadow-sm h-100">
      <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">{title}</h5>
        <Badge bg="light" text="dark">Month to date</Badge>
      </Card.Header>
      <Card.Body className="d-flex flex-column">
        <div className="text-muted small">{currentMonthLabel()}</div>
        <div className="display-4 fw-bold mt-2 mb-1">
          {loading && count == null ? "…" : count == null ? "—" : count}
        </div>
        <div className="fw-bold">{noun}</div>

        <div className="mt-auto pt-4">
          {error ? (
            <div className="text-warning small">{error}</div>
          ) : (
            <div className="text-muted small">{latestReportLabel(latestReport)}</div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}

function getProfilePhotoUrl(u) {
  // Try the most likely keys used elsewhere in the app/server
  const raw =
    u?.photoUrl ||
    u?.profilePhotoUrl ||
    u?.profilePicUrl ||
    u?.avatarUrl ||
    u?.photo ||
    u?.avatar ||
    "";

  const url = String(raw || "").trim();
  if (!url) return "";

  // If backend stores relative paths, keep them relative (nginx serves /uploads)
  // If it's already absolute (http/https), keep it as-is.
  return url;
}

function UserCell({ user }) {
  const label = user?.name || user?.email || "Unknown";
  const photoUrl = getProfilePhotoUrl(user);
  const initials = getInitials(label);

  const size = 28;

  return (
    <div className="d-flex align-items-center gap-2">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid rgba(0,0,0,0.08)"
          }}
          onError={(e) => {
            // If image fails, fall back to initials
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            background: "rgba(0,0,0,0.06)",
            border: "1px solid rgba(0,0,0,0.08)"
          }}
          title={label}
        >
          {initials}
        </div>
      )}

      <div className="fw-bold" style={{ lineHeight: 1.1 }}>
        {label}
        {user?.email && user?.name ? (
          <div className="text-muted fw-normal" style={{ fontSize: 12 }}>
            {user.email}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------
// Dashboard
// ---------------------------
export default function DashboardOverview() {
  // ---------------------------
  // Auth token
  // ---------------------------
  const authToken = orgLocalStorage.getItem("authToken") || "";

  // ---------------------------
  // Presence (online / last seen)
  // Heartbeats are sent globally from Web_UI/src/index.js so presence remains
  // accurate while the user is working anywhere in Maintenix.
  // ---------------------------
  const [presenceUsers, setPresenceUsers] = useState([]);
  const [presenceErr, setPresenceErr] = useState("");

  const [monthlyTracker, setMonthlyTracker] = useState({
    servicingCount: null,
    calloutCount: null,
    latestServicing: null,
    latestCallout: null
  });
  const [monthlyTrackerLoading, setMonthlyTrackerLoading] = useState(false);
  const [monthlyTrackerErr, setMonthlyTrackerErr] = useState("");

  async function loadPresence() {
    if (!authToken) {
      setPresenceErr("Token missing. Please log in again.");
      setPresenceUsers([]);
      return;
    }

    try {
      setPresenceErr("");
      const res = await fetch("/api/presence/users");

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPresenceErr(data?.message || `Failed to load users (HTTP ${res.status}).`);
        setPresenceUsers([]);
        return;
      }

      setPresenceUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setPresenceErr("Failed to load users (API not reachable).");
      setPresenceUsers([]);
    }
  }

  useEffect(() => {
    loadPresence();
    const loadId = setInterval(loadPresence, 5000);

    return () => clearInterval(loadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  async function loadMonthlyTracker() {
    if (!authToken) {
      setMonthlyTrackerErr("Sign in again to load report totals.");
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setMonthlyTrackerErr("Offline — showing the last loaded totals.");
      return;
    }

    setMonthlyTrackerLoading(true);
    setMonthlyTrackerErr("");

    try {
      const res = await fetch("/api/reports", { headers: {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMonthlyTrackerErr(data?.message || `Unable to load report totals (HTTP ${res.status}).`);
        return;
      }

      const wantedMonth = currentMonthKey();
      const reports = Array.isArray(data.reports) ? data.reports : [];
      const current = reports.filter((report) => reportMonthKey(report) === wantedMonth);

      const servicing = current
        .filter((report) => reportTypeForRow(report) === "SERVICING")
        .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
      const callouts = current
        .filter((report) => reportTypeForRow(report) === "CALLOUT")
        .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));

      setMonthlyTracker({
        servicingCount: servicing.length,
        calloutCount: callouts.length,
        latestServicing: servicing[0] || null,
        latestCallout: callouts[0] || null
      });
    } catch {
      setMonthlyTrackerErr("Report tracker is temporarily unavailable.");
    } finally {
      setMonthlyTrackerLoading(false);
    }
  }

  useEffect(() => {
    loadMonthlyTracker();

    const intervalId = setInterval(() => {
      if (typeof navigator === "undefined" || navigator.onLine !== false) loadMonthlyTracker();
    }, 5 * 60_000);

    const refresh = () => loadMonthlyTracker();
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4 gap-2">
        <div>
          <h4 className="mb-0">Overview</h4>
          <small className="text-muted">User activity</small>
        </div>
      </div>

      <Row className="mb-4 g-3">
        {/* Users online / last seen */}
        <Col xs={12} xl={6}>
          <Card border="light" className="shadow-sm h-100">
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h5 className="mb-0">Users Online / Last Seen</h5>
              <small className="text-muted">Presence</small>
            </Card.Header>

            {presenceErr ? (
              <Alert variant="warning" className="m-3 mb-0">
                {presenceErr}
              </Alert>
            ) : null}

            <Card.Body className="p-0">
              <Table responsive className="table-centered table-nowrap mb-0 rounded mobile-wrap-table">
                <thead className="thead-light">
                  <tr>
                    <th className="border-0">User</th>
                    <th className="border-0">Status</th>
                    <th className="border-0">Last seen</th>
                  </tr>
                </thead>

                <tbody>
                  {presenceUsers.length ? (
                    presenceUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <UserCell user={u} />
                        </td>
                        <td>
                          <Badge bg={u.online ? "success" : "secondary"}>{u.online ? "Online" : "Offline"}</Badge>
                        </td>
                        <td>{u.online ? "Now" : u.lastSeenAt ? timeAgo(u.lastSeenAt) : "Never"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="p-3 text-muted" colSpan={3}>
                        No users to display.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} md={6} xl={3}>
          <MonthlyReportTracker
            title="Monthly Servicing"
            count={monthlyTracker.servicingCount}
            latestReport={monthlyTracker.latestServicing}
            loading={monthlyTrackerLoading}
            error={monthlyTrackerErr}
            noun="Service reports generated"
          />
        </Col>

        <Col xs={12} md={6} xl={3}>
          <MonthlyReportTracker
            title="Monthly Call Outs"
            count={monthlyTracker.calloutCount}
            latestReport={monthlyTracker.latestCallout}
            loading={monthlyTrackerLoading}
            error={monthlyTrackerErr}
            noun="Call Out reports generated"
          />
        </Col>
      </Row>
    </>
  );
}
