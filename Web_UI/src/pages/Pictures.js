import React, { useEffect, useMemo, useState } from "react";
import { Card, Button, Table, Dropdown, Spinner, Alert, Row, Col, Badge } from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter } from "@fortawesome/free-solid-svg-icons";

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
  if (v === "LAST_MONTH") return "Last month";
  if (v === "YTD") return "YTD";
  return "Past 7 days";
}

export default function Pictures() {
  const user = getStoredUser();
  const role = user?.role || "";
  const token = getToken();

  const [range, setRange] = useState("PAST_7_DAYS");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [busyId, setBusyId] = useState(""); // delete busy key
  const [clearing, setClearing] = useState(false);

  const canDL = canDownload(role);
  const isAdmin = canAdmin(role);

  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  async function fetchJson(url, init = {}) {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}), ...authHeaders }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const msg = data?.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchJson(`/api/photos?range=${encodeURIComponent(range)}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  function onDownload(photo) {
    if (!canDL) return;

    const filename = photo?.filename || "photo";
    const url = photo?.downloadUrl || "";

    if (!url) {
      setErr("Download URL not found.");
      return;
    }

    fetch(url, { headers: { ...authHeaders } })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `Download failed (${res.status})`;
          try {
            const j = await res.json();
            msg = j?.message || msg;
          } catch {}
          throw new Error(msg);
        }
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
      })
      .catch((e) => setErr(String(e?.message || e)));
  }

  async function onDelete(row) {
    if (!isAdmin) return;
    const key = `${row.reportId}::${row.photo.filename}`;
    if (!window.confirm("Delete this picture?")) return;

    setBusyId(key);
    setErr("");
    try {
      // ✅ Use query-based delete endpoint to avoid filename-in-path routing issues
      await fetchJson(
        `/api/photos/delete?reportId=${encodeURIComponent(row.reportId)}&filename=${encodeURIComponent(row.photo.filename)}`,
        { method: "DELETE" }
      );
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  }

  async function onClearAll() {
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

  const count = rows.length;

  return (
    <div className="py-4">
      <Row className="align-items-center mb-3">
        <Col>
          <h4 className="mb-0">Pictures</h4>
          <div className="text-muted small">Images captured during servicing (reportphotos).</div>
        </Col>
        <Col xs="auto" className="d-flex align-items-center" style={{ gap: 10 }}>
          <Dropdown className="btn-toolbar me-2">
            <Dropdown.Toggle as={Button} variant="outline-primary" size="sm">
              <FontAwesomeIcon icon={faFilter} className="me-2" />
              {getRangeLabel(range)}
            </Dropdown.Toggle>
            <Dropdown.Menu className="dashboard-dropdown dropdown-menu-end" style={{ "--bs-dropdown-spacer": "0px" }}>
              {["TODAY", "PAST_7_DAYS", "LAST_MONTH", "YTD"].map((v) => (
                <Dropdown.Item key={v} active={v === range} onClick={() => setRange(v)}>
                  {getRangeLabel(v)}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>

          {isAdmin ? (
            <Button variant="outline-danger" size="sm" onClick={onClearAll} disabled={clearing}>
              {clearing ? "Clearing..." : "Clear All"}
            </Button>
          ) : null}

          <Button variant="outline-secondary" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </Col>
      </Row>

      {err ? (
        <Alert variant="danger" className="mb-3">
          {err}
        </Alert>
      ) : null}

      <Card border="light" className="shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="text-muted">
              Total: <Badge bg="secondary">{count}</Badge>
            </div>
            {loading ? (
              <div className="d-flex align-items-center" style={{ gap: 8 }}>
                <Spinner animation="border" size="sm" /> <span className="text-muted">Loading...</span>
              </div>
            ) : null}
          </div>

          <Table responsive className="align-items-center table-flush">
            <thead className="thead-light">
              <tr>
                <th>Picture</th>
                <th>Referenced report</th>
                <th>Captured</th>
                <th style={{ width: 180, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.reportId}::${r.photo.filename}`;
                const busy = busyId === key;
                return (
                  <tr key={key}>
                    <td style={{ width: 170 }}>
                      <div
                        style={{
                          width: 150,
                          height: 200,
                          border: "1px solid #e5e7eb",
                          borderRadius: 6,
                          overflow: "hidden",
                          background: "#fff"
                        }}
                      >
                        <img
                          src={r.photo.url}
                          alt={r.photo.filename}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      </div>
                      <div className="small text-muted mt-1" style={{ maxWidth: 150, wordBreak: "break-word" }}>
                        {r.photo.filename}
                      </div>
                    </td>
                    <td>
                      <div className="fw-bold">{r.reportName || r.reportId}</div>
                      <div className="text-muted small">{r.reportId}</div>
                    </td>
                    <td className="text-muted">{new Date(r.photo.updatedAt).toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="d-inline-flex" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {canDL ? (
                          <Button size="sm" variant="outline-primary" onClick={() => onDownload(r.photo)}>
                            Download
                          </Button>
                        ) : null}
                        {isAdmin ? (
                          <Button size="sm" variant="outline-danger" disabled={busy} onClick={() => onDelete(r)}>
                            {busy ? "Deleting..." : "Delete"}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-muted py-4">
                    No pictures found for this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
