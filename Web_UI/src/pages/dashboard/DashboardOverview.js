import { orgLocalStorage } from "../../config/organization";
import React, { useEffect, useState } from "react";
import { Col, Row, Card, Table, Badge, ProgressBar, Alert } from "@themesberg/react-bootstrap";

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
  // Server metrics from API
  const [serverInfo, setServerInfo] = useState(null);
  const [serverErr, setServerErr] = useState("");

  useEffect(() => {
    let mounted = true;
    let pollId = null;
    const controller = new AbortController();
    const statusPath = "/api/server/status";
    const statusUrl =
      typeof window.__maintenixResolveApiUrl === "function"
        ? window.__maintenixResolveApiUrl(statusPath)
        : statusPath;

    async function load() {
      try {
        setServerErr("");
        const res = await fetch(statusPath, { signal: controller.signal });

        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }

        const data = await res.json();
        const normalized = {
          host: data.host ?? "Unknown",
          cpuUsagePercent: Number.isFinite(Number(data.cpuUsagePercent)) ? Number(data.cpuUsagePercent) : 0,
          storageUsedPercent: Number.isFinite(Number(data.storageUsedPercent)) ? Number(data.storageUsedPercent) : 0,
          storageFreeGB: Number.isFinite(Number(data.storageFreeGB)) ? Number(data.storageFreeGB) : 0
        };

        if (mounted) setServerInfo(normalized);
        return true;
      } catch (e) {
        if (e?.name === "AbortError") return false;
        if (!mounted) return false;

        setServerInfo(null);

        if (e?.status === 404) {
          setServerErr(
            `Server metrics endpoint is not available: ${statusUrl} (HTTP 404). The API may still be online.`
          );
          return false;
        }

        setServerErr(
          `Server metrics unavailable from ${statusUrl}${e?.status ? ` (HTTP ${e.status})` : ""}.`
        );
        return true;
      }
    }

    load().then((shouldPoll) => {
      if (mounted && shouldPoll) pollId = setInterval(load, 10000);
    });

    return () => {
      mounted = false;
      if (pollId) clearInterval(pollId);
      controller.abort();
    };
  }, []);

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

  async function loadPresence() {
    if (!authToken) {
      setPresenceErr("Token missing. Please log in again.");
      setPresenceUsers([]);
      return;
    }

    try {
      setPresenceErr("");
      const res = await fetch("/api/presence/users", {
        headers: { Authorization: `Bearer ${authToken}` }
      });

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

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4 gap-2">
        <div>
          <h4 className="mb-0">Overview</h4>
          <small className="text-muted">Server status and user activity</small>
        </div>
      </div>

      {serverErr ? (
        <Alert variant="warning" className="mb-4">
          {serverErr} Make sure the Maintenix API is running and reachable via <code>/api</code>. In local development, use the React dev proxy.
        </Alert>
      ) : null}

      <Row className="mb-4">
        {/* Server info */}
        <Col xs={12} xl={4} className="mb-4 mb-xl-0">
          <Card border="light" className="shadow-sm h-100">
            <Card.Header>
              <h5 className="mb-0">Server Info</h5>
            </Card.Header>
            <Card.Body>
              <div className="mb-3">
                <div className="text-muted">Host</div>
                <div className="fw-bold">{serverInfo?.host ?? "Loading..."}</div>
              </div>

              <div className="mb-3">
                <div className="d-flex justify-content-between">
                  <span className="text-muted">CPU usage</span>
                  <span className="fw-bold">{serverInfo ? `${serverInfo.cpuUsagePercent}%` : "--"}</span>
                </div>
                <ProgressBar now={serverInfo?.cpuUsagePercent ?? 0} min={0} max={100} />
              </div>

              <div className="mb-2">
                <div className="d-flex justify-content-between">
                  <span className="text-muted">Storage used</span>
                  <span className="fw-bold">{serverInfo ? `${serverInfo.storageUsedPercent}%` : "--"}</span>
                </div>
                <ProgressBar now={serverInfo?.storageUsedPercent ?? 0} min={0} max={100} />
              </div>

              <div className="text-muted">
                Free space: <span className="fw-bold">{serverInfo ? `${serverInfo.storageFreeGB} GB` : "--"}</span>
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* Users online / last seen */}
        <Col xs={12} xl={8}>
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
      </Row>
    </>
  );
}
