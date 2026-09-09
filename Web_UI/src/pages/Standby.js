import React, { useEffect, useMemo, useState } from "react";
import { Row, Col, Card, Form, Button, Table, Alert, Badge, ButtonGroup } from "@themesberg/react-bootstrap";

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function safeRole(x) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}

function canEditStandby(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L3" || r === "LEVEL3" || r === "LEVEL_3";
}

function getISOWeek(d) {
  // https://en.wikipedia.org/wiki/ISO_week_date#Calculation
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday in current week decides the year.
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function toYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function addGlobalNotification(message, type = "global_notice") {
  const text = String(message || "").trim();
  if (!text) return;

  const items = readNotifications();
  items.unshift({
    id: makeNotificationId(),
    type,
    message: text,
    createdAt: new Date().toISOString(),
    global: true,
    readBy: []
  });
  writeNotifications(items);
}

export default function Standby() {
  const authUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);
  const role = authUser?.role || "";
  const token = localStorage.getItem("authToken") || "";
  const editor = canEditStandby(role);

  const [allUsers, setAllUsers] = useState([]);
  const [addUserId, setAddUserId] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState([]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [config, setConfig] = useState(null);
  const [schedule, setSchedule] = useState([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const weekNo = useMemo(() => getISOWeek(new Date()), []);

  const usersById = useMemo(() => {
    const m = new Map();
    for (const u of allUsers) m.set(String(u.id), u);
    return m;
  }, [allUsers]);

  const selectedUsers = useMemo(() => {
    return selectedUserIds.map((id) => usersById.get(String(id)) || { id, name: id, email: "" });
  }, [selectedUserIds, usersById]);

  async function apiFetch(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const res = await fetch(url, { ...opts, headers });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  }

  async function loadSchedule() {
    setError("");
    const { res, data } = await apiFetch("/api/standby/schedule");
    if (!res.ok || !data?.ok) {
      setError(data?.message || `Failed to load standby schedule (HTTP ${res.status}).`);
      return;
    }

    setConfig(data.config || null);
    setSchedule(Array.isArray(data.schedule) ? data.schedule : []);

    // If a schedule exists, prime the editor controls with it
    if (editor && data.config) {
      const ids = Array.isArray(data.config.userIds) ? data.config.userIds : [];
      setSelectedUserIds(ids.map((x) => String(x)));
      setStartDate(String(data.config.startDate || ""));
      setEndDate(String(data.config.endDate || ""));
    }
  }

  async function loadUsers() {
    if (!editor) return;
    setError("");
    const { res, data } = await apiFetch("/api/standby/registered-users");
    if (!res.ok || !data?.ok) {
      setError(data?.message || `Failed to load users (HTTP ${res.status}).`);
      return;
    }
    setAllUsers(Array.isArray(data.users) ? data.users : []);
  }

  useEffect(() => {
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  function addSelectedUser() {
    const id = String(addUserId || "").trim();
    if (!id) return;
    if (selectedUserIds.includes(id)) {
      setAddUserId("");
      return;
    }
    setSelectedUserIds([...selectedUserIds, id]);
    setAddUserId("");
  }

  function removeUser(id) {
    setSelectedUserIds(selectedUserIds.filter((x) => String(x) !== String(id)));
  }

  function moveUser(id, dir) {
    const idx = selectedUserIds.findIndex((x) => String(x) === String(id));
    if (idx === -1) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= selectedUserIds.length) return;

    const copy = [...selectedUserIds];
    const tmp = copy[idx];
    copy[idx] = copy[nextIdx];
    copy[nextIdx] = tmp;
    setSelectedUserIds(copy);
  }

  async function createSchedule() {
    setError("");
    setNotice("");

    if (!startDate || !endDate) {
      setError("Please enter both a Start Date and End Date.");
      return;
    }
    if (selectedUserIds.length === 0) {
      setError("Please add at least 1 user to the standby list.");
      return;
    }

    setBusy(true);
    try {
      const body = { userIds: selectedUserIds, startDate, endDate };
      const { res, data } = await apiFetch("/api/standby/schedule", {
        method: "POST",
        body: JSON.stringify(body)
      });

      if (!res.ok || !data?.ok) {
        setError(data?.message || `Failed to create schedule (HTTP ${res.status}).`);
        return;
      }

      const nextConfig = data.config || null;
      const nextSchedule = Array.isArray(data.schedule) ? data.schedule : [];

      setConfig(nextConfig);
      setSchedule(nextSchedule);
      setNotice("Standby schedule created.");

      const todayStr = toYmd(new Date());
      const todayEntry =
        nextSchedule.find((r) => {
          const s = String(r?.startDate || "");
          const e = String(r?.endDate || "");
          return s && e && s <= todayStr && todayStr <= e;
        }) || nextSchedule[0] || null;

      if (todayEntry?.userName) {
        addGlobalNotification(`"${todayEntry.userName}" on standby`, "standby_changed");
      } else {
        addGlobalNotification("Standby rotation updated", "standby_changed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearSchedule() {
    setError("");
    setNotice("");

    if (!editor) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm("Clear the current standby schedule? This cannot be undone.");
    if (!ok) return;

    setBusy(true);
    try {
      const { res, data } = await apiFetch("/api/standby/schedule", { method: "DELETE" });
      if (!res.ok || !data?.ok) {
        setError(data?.message || `Failed to clear schedule (HTTP ${res.status}).`);
        return;
      }
      setConfig(null);
      setSchedule([]);
      setNotice("Standby schedule cleared.");
      addGlobalNotification("Standby rotation cleared", "standby_cleared");
    } finally {
      setBusy(false);
    }
  }

  const todayAssignment = useMemo(() => {
    const todayStr = toYmd(new Date());
    const entry =
      (Array.isArray(schedule) ? schedule : []).find((r) => {
        const s = String(r?.startDate || "");
        const e = String(r?.endDate || "");
        return s && e && s <= todayStr && todayStr <= e;
      }) || null;
    return { todayStr, entry };
  }, [schedule]);

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div className="d-block mb-4 mb-md-0">
          <h4>Standby</h4>
          <p className="mb-0">Standby Schedule.</p>
        </div>
      </div>

      {error ? (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      ) : null}

      <Row className="mb-4">
        <Col xs={12} lg={6} className="mb-4 mb-lg-0">
          <Card className="border-0 shadow h-100">
            <Card.Body className="d-flex flex-wrap justify-content-between align-items-center">
              <div>
                <div className="h6 mb-1">Current Week</div>
                <div className="h3 mb-0">Week {weekNo}</div>
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card className="border-0 shadow h-100">
            <Card.Body className="d-flex flex-wrap justify-content-between align-items-center">
              <div>
                <div className="h6 mb-1">On Standby Today</div>
                {todayAssignment.entry ? (
                  <div className="h3 mb-0">
                    {todayAssignment.entry.userName}
                    <Badge bg="info" className="ms-2">
                      Rotation {todayAssignment.entry.rotation}
                    </Badge>
                  </div>
                ) : (
                  <div className="h4 mb-0 text-muted">No assignment</div>
                )}
                {todayAssignment.entry ? (
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {todayAssignment.entry.startDate} &#8594; {todayAssignment.entry.endDate}
                  </div>
                ) : (
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {schedule.length
                      ? "Today's date is outside the configured schedule range."
                      : "Create a schedule to see who is on standby."}
                  </div>
                )}
              </div>
              <div className="text-muted text-end">
                <div style={{ fontSize: 12 }}>Today</div>
                <div className="fw-bold" style={{ fontSize: 18 }}>
                  {todayAssignment.todayStr}
                </div>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col xs={12} lg={6} className="mb-4 mb-lg-0">
          <Card className="border-0 shadow h-100">
            <Card.Header className="border-0">
              <div className="d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Standby List</h5>
                {editor ? <Badge bg="info">Admin / L3</Badge> : <Badge bg="secondary">View only</Badge>}
              </div>
            </Card.Header>
            <Card.Body>
              {!editor ? (
                <Alert variant="light" className="mb-0">
                  You can view the current standby schedule, but only Admin and L3 users can edit the standby list.
                </Alert>
              ) : (
                <>
                  <Form
                    className="mb-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addSelectedUser();
                    }}
                  >
                    <Row className="g-2">
                      <Col xs={12} md={8}>
                        <Form.Select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                          <option value="">Select a user</option>
                          {allUsers
                            .slice()
                            .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)))
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name || u.email} ({u.email})
                              </option>
                            ))}
                        </Form.Select>
                      </Col>
                      <Col xs={12} md={4}>
                        <Button variant="primary" type="submit" className="w-100" disabled={!addUserId}>
                          Add
                        </Button>
                      </Col>
                    </Row>
                  </Form>

                  <div className="table-responsive">
                    <Table hover size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th style={{ width: 70 }}>#</th>
                          <th>User</th>
                          <th style={{ width: 180 }} className="text-end">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUsers.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="text-muted">
                              No users added yet.
                            </td>
                          </tr>
                        ) : (
                          selectedUsers.map((u, i) => (
                            <tr key={u.id}>
                              <td>{i + 1}</td>
                              <td>
                                <div className="fw-bold">{u.name || u.email || u.id}</div>
                                <div className="text-muted" style={{ fontSize: 12 }}>
                                  {u.email || ""}
                                </div>
                              </td>
                              <td className="text-end">
                                <ButtonGroup size="sm">
                                  <Button variant="outline-secondary" onClick={() => moveUser(u.id, -1)} disabled={i === 0}>&#8593;</Button>
                                  <Button variant="outline-secondary" onClick={() => moveUser(u.id, +1)} disabled={i === selectedUsers.length - 1}>&#8595;</Button>
                                  <Button variant="outline-danger" onClick={() => removeUser(u.id)}>Remove</Button>
                                </ButtonGroup>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card className="border-0 shadow h-100">
            <Card.Header className="border-0">
              <h5 className="mb-0">Schedule Dates</h5>
            </Card.Header>
            <Card.Body>
              <Row className="g-3">
                <Col xs={12} md={6}>
                  <Form.Group>
                    <Form.Label>Start Date</Form.Label>
                    <Form.Control type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!editor} />
                  </Form.Group>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Group>
                    <Form.Label>End Date</Form.Label>
                    <Form.Control type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!editor} />
                  </Form.Group>
                </Col>
              </Row>

              {config ? (
                <Alert variant="light" className="mt-3">
                  <div className="d-flex justify-content-between flex-wrap gap-2">
                    <div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Current schedule
                      </div>
                      <div className="fw-bold">
                        {config.startDate} &#8594; {config.endDate}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Created by
                      </div>
                      <div className="fw-bold">{config.createdBy || "-"}</div>
                    </div>
                  </div>
                </Alert>
              ) : (
                <Alert variant="light" className="mt-3 mb-0">
                  No standby schedule has been created yet.
                </Alert>
              )}

              {editor ? (
                <>
                  <Button variant="primary" className="w-100 mt-3" onClick={createSchedule} disabled={busy}>
                    {busy ? "Working…" : "Create / Update Schedule"}
                  </Button>
                  <Button variant="outline-danger" className="w-100 mt-2" onClick={clearSchedule} disabled={busy || !config}>
                    Clear / Remove Schedule
                  </Button>
                </>
              ) : null}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card className="border-0 shadow">
            <Card.Header className="border-0 d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Standby Schedule</h5>
              <Badge bg={schedule.length ? "success" : "secondary"}>{schedule.length ? `${schedule.length} rotation(s)` : "None"}</Badge>
            </Card.Header>
            <Card.Body className="p-0">
              <div className="table-responsive">
                <Table hover className="mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Rotation</th>
                      <th>User</th>
                      <th style={{ width: 160 }}>Start</th>
                      <th style={{ width: 160 }}>End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-muted px-3 py-4">
                          No schedule available.
                        </td>
                      </tr>
                    ) : (
                      schedule.map((r) => (
                        <tr key={`${r.rotation}_${r.userId}_${r.startDate}`}>
                          <td className="px-3">{r.rotation}</td>
                          <td>
                            <div className="fw-bold">{r.userName}</div>
                          </td>
                          <td>{r.startDate}</td>
                          <td>{r.endDate}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}