import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Nav,
  Row,
  Spinner,
  Table
} from "@themesberg/react-bootstrap";

import { Routes } from "../routes";
import { orgLocalStorage } from "../config/organization";

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readAuthUser() {
  return safeJsonParse(orgLocalStorage.getItem("authUser") || "null", null);
}

async function apiRequest(path, options = {}) {
  const token = orgLocalStorage.getItem("authToken") || "";
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const error = new Error(data?.message || `Request failed (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function queryState(search) {
  const params = new URLSearchParams(search || "");
  const tab = String(params.get("tab") || "areas").toLowerCase();
  const status = String(params.get("status") || "").toLowerCase();
  return {
    tab: ["users", "areas", "notifications"].includes(tab) ? tab : "areas",
    pendingOnly: status === "pending"
  };
}

function sourceLabel(area) {
  if (area?.source === "RUNTIME" && area?.status === "CONFIGURED") return "Admin metadata";
  if (area?.source === "BASELINE") return "Reference data";
  if (area?.status === "PENDING") return "Metadata required";
  return area?.source || "—";
}

function normalizeUserStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function userStatusLabel(value) {
  const status = normalizeUserStatus(value);
  if (status === "APPROVED") return "Active";
  if (status === "PENDING") return "Pending";
  if (status === "DENIED") return "Denied";
  return status || "Unknown";
}

function userStatusVariant(value) {
  const status = normalizeUserStatus(value);
  if (status === "APPROVED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "DENIED") return "danger";
  return "secondary";
}

function formatAdminDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

export default function Administration() {
  const history = useHistory();
  const location = useLocation();
  const authUser = readAuthUser();
  const isAdmin = String(authUser?.role || "").trim().toUpperCase() === "ADMIN";

  const initial = queryState(location.search);
  const [activeTab, setActiveTab] = useState(initial.tab);
  const [pendingOnly, setPendingOnly] = useState(initial.pendingOnly);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userError, setUserError] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState("ALL");
  const [userActionId, setUserActionId] = useState("");
  const [userToDelete, setUserToDelete] = useState(null);

  const [notificationEvents, setNotificationEvents] = useState([]);
  const [loadingNotificationEvents, setLoadingNotificationEvents] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventCategory, setEventCategory] = useState("ALL");
  const [broadcastForm, setBroadcastForm] = useState({
    title: "",
    message: "",
    requiresAck: false
  });
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  const [areas, setAreas] = useState([]);
  const [sections, setSections] = useState([]);
  const [summary, setSummary] = useState({ total: 0, configured: 0, pending: 0, runtimeConfigured: 0 });
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [areaError, setAreaError] = useState("");
  const [areaMessage, setAreaMessage] = useState("");
  const [search, setSearch] = useState("");

  const [editingArea, setEditingArea] = useState(null);
  const [form, setForm] = useState({ section: "", baseArea: "", first: "", second: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const next = queryState(location.search);
    setActiveTab(next.tab);
    setPendingOnly(next.pendingOnly);
  }, [location.search]);

  const setAdministrationQuery = useCallback((tab, pending) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (tab === "areas" && pending) params.set("status", "pending");
    history.replace(`${Routes.Administration.path}?${params.toString()}`);
  }, [history]);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    setUserError("");

    try {
      const data = await apiRequest("/api/admin/users");
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (error) {
      setUserError(String(error?.message || "Unable to load users."));
    } finally {
      setLoadingUsers(false);
    }
  }, [isAdmin]);

  async function runUserAction(userId, action, successMessage) {
    const id = String(userId || "");
    if (!id || userActionId) return;

    setUserActionId(id);
    setUserError("");
    setUserMessage("");

    try {
      await action();
      setUserMessage(successMessage);
      await loadUsers();
    } catch (error) {
      setUserError(String(error?.message || "Unable to update user."));
    } finally {
      setUserActionId("");
    }
  }

  function approveUser(user) {
    return runUserAction(
      user?.id,
      () => apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/approve`, { method: "POST" }),
      `${user?.name || user?.email || "User"} approved.`
    );
  }

  function denyUser(user) {
    return runUserAction(
      user?.id,
      () => apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/deny`, { method: "POST" }),
      `${user?.name || user?.email || "User"} denied.`
    );
  }

  function changeUserRole(user, nextRole) {
    return runUserAction(
      user?.id,
      () => apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole })
      }),
      `${user?.name || user?.email || "User"} role updated to ${nextRole}.`
    );
  }

  async function confirmDeleteUser() {
    const user = userToDelete;
    if (!user) return;

    await runUserAction(
      user.id,
      () => apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" }),
      `${user?.name || user?.email || "User"} removed.`
    );
    setUserToDelete(null);
  }

  const loadNotificationEvents = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingNotificationEvents(true);
    setNotificationError("");

    try {
      const data = await apiRequest("/api/notifications/events");
      setNotificationEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (error) {
      setNotificationError(String(error?.message || "Unable to load notification events."));
    } finally {
      setLoadingNotificationEvents(false);
    }
  }, [isAdmin]);

  function updateBroadcastField(field, value) {
    setBroadcastForm((current) => ({ ...current, [field]: value }));
  }

  async function sendBroadcast(event) {
    event.preventDefault();

    const title = String(broadcastForm.title || "").trim();
    const message = String(broadcastForm.message || "").trim();
    if (!title) {
      setNotificationError("Broadcast title is required.");
      return;
    }
    if (!message) {
      setNotificationError("Broadcast message is required.");
      return;
    }

    setSendingBroadcast(true);
    setNotificationError("");
    setNotificationMessage("");

    try {
      await apiRequest("/api/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          title,
          message,
          requiresAck: !!broadcastForm.requiresAck
        })
      });

      setNotificationMessage(
        broadcastForm.requiresAck
          ? "Broadcast sent to all users with acknowledgement required."
          : "Broadcast sent to all users."
      );
      setBroadcastForm({ title: "", message: "", requiresAck: false });
    } catch (error) {
      setNotificationError(String(error?.message || "Unable to send broadcast."));
    } finally {
      setSendingBroadcast(false);
    }
  }

  const loadAreas = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingAreas(true);
    setAreaError("");

    try {
      const data = await apiRequest("/api/admin/areas");
      setAreas(Array.isArray(data?.areas) ? data.areas : []);
      setSections(Array.isArray(data?.sections) ? data.sections : []);
      setSummary({
        total: Number(data?.summary?.total || 0),
        configured: Number(data?.summary?.configured || 0),
        pending: Number(data?.summary?.pending || 0),
        runtimeConfigured: Number(data?.summary?.runtimeConfigured || 0)
      });
    } catch (error) {
      setAreaError(String(error?.message || "Unable to load area administration data."));
    } finally {
      setLoadingAreas(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === "users") loadUsers();
  }, [activeTab, loadUsers]);

  useEffect(() => {
    if (activeTab === "notifications") loadNotificationEvents();
  }, [activeTab, loadNotificationEvents]);

  useEffect(() => {
    if (activeTab === "areas") loadAreas();
  }, [activeTab, loadAreas]);

  const userSummary = useMemo(() => ({
    total: users.length,
    pending: users.filter((user) => normalizeUserStatus(user.status) === "PENDING").length,
    active: users.filter((user) => normalizeUserStatus(user.status) === "APPROVED").length,
    denied: users.filter((user) => normalizeUserStatus(user.status) === "DENIED").length
  }), [users]);

  const visibleUsers = useMemo(() => {
    const needle = String(userSearch || "").trim().toLowerCase();

    return users
      .filter((user) => {
        const status = normalizeUserStatus(user.status);
        if (userFilter === "PENDING" && status !== "PENDING") return false;
        if (userFilter === "APPROVED" && status !== "APPROVED") return false;
        if (userFilter === "DENIED" && status !== "DENIED") return false;

        if (!needle) return true;
        return [user.name, user.email, user.role, userStatusLabel(user.status)]
          .some((value) => String(value || "").toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const statusOrder = { PENDING: 0, APPROVED: 1, DENIED: 2 };
        const aStatus = normalizeUserStatus(a.status);
        const bStatus = normalizeUserStatus(b.status);
        const statusDiff = (statusOrder[aStatus] ?? 9) - (statusOrder[bStatus] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        return String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""));
      });
  }, [users, userFilter, userSearch]);

  const notificationCategories = useMemo(() => {
    const categories = new Set(
      notificationEvents
        .map((event) => String(event?.category || "").trim().toUpperCase())
        .filter(Boolean)
    );
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [notificationEvents]);

  const notificationSummary = useMemo(() => ({
    total: notificationEvents.length,
    mandatory: notificationEvents.filter((event) => !!event.mandatory).length,
    acknowledgement: notificationEvents.filter((event) => !!event.defaultRequiresAck).length,
    categories: notificationCategories.length
  }), [notificationEvents, notificationCategories]);

  const visibleNotificationEvents = useMemo(() => {
    const needle = String(eventSearch || "").trim().toLowerCase();
    const wantedCategory = String(eventCategory || "ALL").toUpperCase();

    return notificationEvents
      .filter((event) => {
        const category = String(event?.category || "").trim().toUpperCase();
        if (wantedCategory !== "ALL" && category !== wantedCategory) return false;
        if (!needle) return true;

        return [
          event?.eventType,
          event?.type,
          event?.category,
          event?.description,
          ...(Array.isArray(event?.deliveryChannels) ? event.deliveryChannels : [])
        ].some((value) => String(value || "").toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const categoryDiff = String(a?.category || "").localeCompare(String(b?.category || ""));
        if (categoryDiff !== 0) return categoryDiff;
        return String(a?.eventType || "").localeCompare(String(b?.eventType || ""));
      });
  }, [notificationEvents, eventSearch, eventCategory]);

  const visibleAreas = useMemo(() => {
    const needle = String(search || "").trim().toLowerCase();
    return areas.filter((area) => {
      if (pendingOnly && area.status !== "PENDING") return false;
      if (!needle) return true;
      return [
        area.area,
        area.section,
        area.baseArea,
        area.first,
        area.second,
        area.addedBy,
        sourceLabel(area)
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [areas, pendingOnly, search]);

  function openEditor(area) {
    setEditingArea(area);
    setForm({
      section: area?.status === "CONFIGURED" ? String(area?.section || "") : "",
      baseArea: String(area?.baseArea || ""),
      first: String(area?.first || ""),
      second: String(area?.second || "")
    });
    setSaveError("");
    setAreaMessage("");
  }

  function closeEditor() {
    if (saving) return;
    setEditingArea(null);
    setSaveError("");
  }

  function updateFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveMetadata(event) {
    event.preventDefault();
    if (!editingArea) return;

    if (!String(form.section || "").trim()) {
      setSaveError("Select a Section.");
      return;
    }

    setSaving(true);
    setSaveError("");

    try {
      const data = await apiRequest(
        `/api/admin/areas/${encodeURIComponent(editingArea.area)}/metadata`,
        {
          method: "PATCH",
          body: JSON.stringify({
            section: form.section,
            baseArea: form.baseArea,
            first: form.first,
            second: form.second
          })
        }
      );

      setEditingArea(null);
      setAreaMessage(
        `${data?.area?.area || editingArea.area} metadata saved. Future reports will use ${data?.area?.section || form.section}.`
      );
      await loadAreas();
    } catch (error) {
      setSaveError(String(error?.message || "Unable to save area metadata."));
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <>
        <div className="py-4">
          <h4 className="mb-1">Administration</h4>
          <div className="text-muted">Administrative functions are restricted to CRA Administrators.</div>
        </div>
        <Alert variant="danger">Admin access is required to open this page.</Alert>
      </>
    );
  }

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div>
          <h4 className="mb-1">Administration</h4>
          <div className="text-muted">
            Manage organisation users, area metadata and future notification configuration.
          </div>
        </div>
      </div>

      <Card border="light" className="shadow-sm mb-4">
        <Card.Body className="pt-0">
          <Nav
            variant="tabs"
            activeKey={activeTab}
            onSelect={(key) => {
              const tab = key || "areas";
              setAdministrationQuery(tab, tab === "areas" ? pendingOnly : false);
            }}
          >
            <Nav.Item>
              <Nav.Link eventKey="users">Users</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="areas">
                Areas
                {summary.pending > 0 ? (
                  <Badge bg="warning" text="dark" className="ms-2">{summary.pending}</Badge>
                ) : null}
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="notifications">Notifications</Nav.Link>
            </Nav.Item>
          </Nav>
        </Card.Body>
      </Card>

      {activeTab === "users" ? (
        <>
          {userError ? <Alert variant="danger">{userError}</Alert> : null}
          {userMessage ? <Alert variant="success">{userMessage}</Alert> : null}

          <Row className="g-3 mb-4">
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">All users</div>
                  <div className="h4 mb-0">{userSummary.total}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Pending</div>
                  <div className="h4 mb-0">{userSummary.pending}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Active</div>
                  <div className="h4 mb-0">{userSummary.active}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Denied</div>
                  <div className="h4 mb-0">{userSummary.denied}</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card border="light" className="shadow-sm">
            <Card.Header>
              <div className="d-flex flex-wrap justify-content-between align-items-center" style={{ gap: 12 }}>
                <div>
                  <h5 className="mb-1">User management</h5>
                  <div className="text-muted small">
                    Approve registrations, assign access roles and remove user accounts.
                  </div>
                </div>
                <Button type="button" variant="outline-primary" size="sm" onClick={loadUsers} disabled={loadingUsers}>
                  {loadingUsers ? <><Spinner size="sm" className="me-2" /> Refreshing…</> : "Refresh"}
                </Button>
              </div>
            </Card.Header>

            <Card.Body>
              <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-end mb-3" style={{ gap: 12 }}>
                <Form.Group className="mobile-min-width-0" style={{ minWidth: 240, flex: "1 1 320px" }}>
                  <Form.Label>Search users</Form.Label>
                  <Form.Control
                    type="search"
                    value={userSearch}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setUserSearch(value);
                    }}
                    placeholder="Name, email, role or status"
                  />
                </Form.Group>

                <div className="d-flex flex-column flex-sm-row" style={{ gap: 8 }}>
                  <Button
                    type="button"
                    size="sm"
                    variant={userFilter === "ALL" ? "primary" : "outline-primary"}
                    onClick={() => setUserFilter("ALL")}
                  >
                    All ({userSummary.total})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={userFilter === "PENDING" ? "warning" : "outline-warning"}
                    onClick={() => setUserFilter("PENDING")}
                  >
                    Pending ({userSummary.pending})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={userFilter === "APPROVED" ? "success" : "outline-success"}
                    onClick={() => setUserFilter("APPROVED")}
                  >
                    Active ({userSummary.active})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={userFilter === "DENIED" ? "danger" : "outline-danger"}
                    onClick={() => setUserFilter("DENIED")}
                  >
                    Denied ({userSummary.denied})
                  </Button>
                </div>
              </div>

              {loadingUsers && users.length === 0 ? (
                <div className="text-center py-5">
                  <Spinner animation="border" role="status" />
                  <div className="text-muted mt-2">Loading users…</div>
                </div>
              ) : visibleUsers.length === 0 ? (
                <Alert variant="info" className="mb-0">
                  No users match the current filter.
                </Alert>
              ) : (
                <div className="table-responsive d-none d-md-block">
                  <Table
                    hover
                    size="sm"
                    className="align-middle mb-0 mobile-wrap-table"
                    style={{ fontSize: "0.875rem", width: "100%" }}
                  >
                  <thead>
                    <tr>
                      <th className="px-2 py-2" style={{ width: "22%" }}>User</th>
                      <th className="px-2 py-2" style={{ width: "23%" }}>Email</th>
                      <th className="px-2 py-2" style={{ width: "13%" }}>Role</th>
                      <th className="px-2 py-2" style={{ width: "12%" }}>Status</th>
                      <th className="px-2 py-2" style={{ width: "15%" }}>Created</th>
                      <th className="px-2 py-2 text-end" style={{ width: "15%" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => {
                      const status = normalizeUserStatus(user.status);
                      const isSelf = String(user.id || "") === String(authUser?.id || "");
                      const busy = userActionId === String(user.id || "");

                      return (
                        <tr key={user.id}>
                          <td className="px-2 py-2" style={{ overflowWrap: "anywhere" }}>
                            <div className="fw-bold">{user.name || "Unnamed user"}</div>
                            {isSelf ? <div className="text-muted small">Current account</div> : null}
                          </td>
                          <td className="px-2 py-2" style={{ overflowWrap: "anywhere" }}>{user.email || "—"}</td>
                          <td className="px-2 py-2">
                            <Form.Select
                              size="sm"
                              value={String(user.role || "L1").toUpperCase()}
                              disabled={busy || isSelf}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                changeUserRole(user, value);
                              }}
                              aria-label={`Role for ${user.name || user.email || "user"}`}
                            >
                              <option value="L1">L1</option>
                              <option value="L2">L2</option>
                              <option value="L3">L3</option>
                              <option value="ADMIN">ADMIN</option>
                            </Form.Select>
                          </td>
                          <td className="px-2 py-2">
                            <Badge
                              bg={userStatusVariant(user.status)}
                              text={status === "PENDING" ? "dark" : undefined}
                            >
                              {userStatusLabel(user.status)}
                            </Badge>
                          </td>
                          <td className="px-2 py-2">
                            <div>{formatAdminDate(user.createdAt)}</div>
                            {user.approvedBy ? (
                              <div className="text-muted small">By {user.approvedBy}</div>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 text-end">
                            <div className="d-flex flex-wrap justify-content-end" style={{ gap: 6 }}>
                              {status !== "APPROVED" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="success"
                                  disabled={busy}
                                  onClick={() => approveUser(user)}
                                >
                                  {busy ? <Spinner size="sm" /> : "Approve"}
                                </Button>
                              ) : null}

                              {status === "PENDING" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={busy}
                                  onClick={() => denyUser(user)}
                                >
                                  Deny
                                </Button>
                              ) : null}

                              {!isSelf ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={busy}
                                  onClick={() => {
                                    setUserError("");
                                    setUserMessage("");
                                    setUserToDelete(user);
                                  }}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                </div>

                <div className="d-md-none">
                  {visibleUsers.map((user) => {
                    const status = normalizeUserStatus(user.status);
                    const isSelf = String(user.id || "") === String(authUser?.id || "");
                    const busy = userActionId === String(user.id || "");

                    return (
                      <Card key={user.id} border="light" className="shadow-sm mb-3">
                        <Card.Body>
                          <div className="d-flex flex-column" style={{ gap: 12 }}>
                            <div className="mobile-break-anywhere">
                              <div className="fw-bold">{user.name || "Unnamed user"}</div>
                              {isSelf ? <div className="text-muted small">Current account</div> : null}
                              <div className="text-muted small mobile-break-anywhere">{user.email || "—"}</div>
                            </div>

                            <div>
                              <div className="text-muted small mb-1">Status</div>
                              <Badge
                                bg={userStatusVariant(user.status)}
                                text={status === "PENDING" ? "dark" : undefined}
                              >
                                {userStatusLabel(user.status)}
                              </Badge>
                            </div>

                            <Form.Group>
                              <Form.Label className="text-muted small mb-1">Role</Form.Label>
                              <Form.Select
                                size="sm"
                                value={String(user.role || "L1").toUpperCase()}
                                disabled={busy || isSelf}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  changeUserRole(user, value);
                                }}
                                aria-label={`Role for ${user.name || user.email || "user"}`}
                              >
                                <option value="L1">L1</option>
                                <option value="L2">L2</option>
                                <option value="L3">L3</option>
                                <option value="ADMIN">ADMIN</option>
                              </Form.Select>
                            </Form.Group>

                            <div>
                              <div className="text-muted small">Created</div>
                              <div>{formatAdminDate(user.createdAt)}</div>
                              {user.approvedBy ? <div className="text-muted small">By {user.approvedBy}</div> : null}
                            </div>

                            <div className="d-grid" style={{ gap: 8 }}>
                              {status !== "APPROVED" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="success"
                                  disabled={busy}
                                  onClick={() => approveUser(user)}
                                >
                                  {busy ? <Spinner size="sm" /> : "Approve"}
                                </Button>
                              ) : null}

                              {status === "PENDING" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={busy}
                                  onClick={() => denyUser(user)}
                                >
                                  Deny
                                </Button>
                              ) : null}

                              {!isSelf ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={busy}
                                  onClick={() => {
                                    setUserError("");
                                    setUserMessage("");
                                    setUserToDelete(user);
                                  }}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </Card.Body>
                      </Card>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}

      {activeTab === "notifications" ? (
        <>
          {notificationError ? <Alert variant="danger">{notificationError}</Alert> : null}
          {notificationMessage ? <Alert variant="success">{notificationMessage}</Alert> : null}

          <Row className="g-3 mb-4">
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Registered events</div>
                  <div className="h4 mb-0">{notificationSummary.total}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Mandatory</div>
                  <div className="h4 mb-0">{notificationSummary.mandatory}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Default acknowledgement</div>
                  <div className="h4 mb-0">{notificationSummary.acknowledgement}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} sm={6} md={3}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Categories</div>
                  <div className="h4 mb-0">{notificationSummary.categories}</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card border="light" className="shadow-sm mb-4">
            <Card.Header>
              <h5 className="mb-1">Send broadcast</h5>
              <div className="text-muted small">
                Send a CRA notification to all users. In-app notification storage is created first; device push delivery remains asynchronous.
              </div>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={sendBroadcast}>
                <Row className="g-3">
                  <Col xs={12} lg={4}>
                    <Form.Group>
                      <Form.Label>Title</Form.Label>
                      <Form.Control
                        value={broadcastForm.title}
                        maxLength={120}
                        disabled={sendingBroadcast}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          updateBroadcastField("title", value);
                        }}
                        placeholder="Broadcast title"
                      />
                      <Form.Text className="text-muted">
                        {String(broadcastForm.title || "").length}/120
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col xs={12} lg={8}>
                    <Form.Group>
                      <Form.Label>Message</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={broadcastForm.message}
                        maxLength={1000}
                        disabled={sendingBroadcast}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          updateBroadcastField("message", value);
                        }}
                        placeholder="Message to all CRA users"
                      />
                      <Form.Text className="text-muted">
                        {String(broadcastForm.message || "").length}/1000
                      </Form.Text>
                    </Form.Group>
                  </Col>
                </Row>

                <div className="d-flex flex-wrap justify-content-between align-items-center mt-3" style={{ gap: 12 }}>
                  <Form.Check
                    type="switch"
                    id="admin-broadcast-requires-ack"
                    checked={!!broadcastForm.requiresAck}
                    disabled={sendingBroadcast}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      updateBroadcastField("requiresAck", checked);
                    }}
                    label="Require acknowledgement"
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={sendingBroadcast}>
                    {sendingBroadcast ? <><Spinner size="sm" className="me-2" /> Sending…</> : "Send broadcast"}
                  </Button>
                </div>

                {broadcastForm.requiresAck ? (
                  <Alert variant="warning" className="mt-3 mb-0">
                    This notification will remain an attention item for each user until that user acknowledges it.
                  </Alert>
                ) : null}
              </Form>
            </Card.Body>
          </Card>

          <Card border="light" className="shadow-sm">
            <Card.Header>
              <div className="d-flex flex-wrap justify-content-between align-items-center" style={{ gap: 12 }}>
                <div>
                  <h5 className="mb-1">Notification events</h5>
                  <div className="text-muted small">
                    Central registry definitions currently used by CRA. Mandatory system events are shown as locked architecture rules rather than editable switches.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline-primary"
                  size="sm"
                  onClick={loadNotificationEvents}
                  disabled={loadingNotificationEvents}
                >
                  {loadingNotificationEvents ? <><Spinner size="sm" className="me-2" /> Refreshing…</> : "Refresh"}
                </Button>
              </div>
            </Card.Header>

            <Card.Body>
              <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-end mb-3" style={{ gap: 12 }}>
                <Form.Group className="mobile-min-width-0" style={{ minWidth: 240, flex: "1 1 320px" }}>
                  <Form.Label>Search events</Form.Label>
                  <Form.Control
                    type="search"
                    value={eventSearch}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEventSearch(value);
                    }}
                    placeholder="Event, category, channel or description"
                  />
                </Form.Group>

                <Form.Group className="mobile-min-width-0" style={{ minWidth: 190 }}>
                  <Form.Label>Category</Form.Label>
                  <Form.Select
                    value={eventCategory}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEventCategory(value);
                    }}
                  >
                    <option value="ALL">All categories</option>
                    {notificationCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>

              {loadingNotificationEvents && notificationEvents.length === 0 ? (
                <div className="text-center py-5">
                  <Spinner animation="border" role="status" />
                  <div className="text-muted mt-2">Loading notification events…</div>
                </div>
              ) : visibleNotificationEvents.length === 0 ? (
                <Alert variant="info" className="mb-0">
                  No notification events match the current filter.
                </Alert>
              ) : (
                <div className="table-responsive">
                  <Table
                    hover
                    size="sm"
                    className="align-middle mb-0 mobile-wrap-table"
                    style={{ fontSize: "0.875rem", width: "100%" }}
                  >
                  <thead>
                    <tr>
                      <th className="px-2 py-2" style={{ width: "34%" }}>Event</th>
                      <th className="px-2 py-2" style={{ width: "14%" }}>Category</th>
                      <th className="px-2 py-2" style={{ width: "20%" }}>Channels</th>
                      <th className="px-2 py-2" style={{ width: "16%" }}>Acknowledgement</th>
                      <th className="px-2 py-2" style={{ width: "16%" }}>Rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleNotificationEvents.map((event) => (
                      <tr key={event.eventType}>
                        <td className="px-2 py-2" style={{ overflowWrap: "anywhere" }}>
                          <div className="fw-bold">{event.eventType}</div>
                          <div className="text-muted small">{event.description || "—"}</div>
                        </td>
                        <td className="px-2 py-2">
                          <Badge bg="secondary">{event.category || "GENERAL"}</Badge>
                        </td>
                        <td className="px-2 py-2">
                          <div className="d-flex flex-wrap" style={{ gap: 4 }}>
                            {(Array.isArray(event.deliveryChannels) ? event.deliveryChannels : []).map((channel) => (
                              <Badge bg="info" text="dark" key={channel}>{channel}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {event.defaultRequiresAck ? (
                            <Badge bg="warning" text="dark">Required by default</Badge>
                          ) : (
                            <Badge bg="light" text="dark">Not required</Badge>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {event.mandatory ? (
                            <Badge bg="danger">Mandatory</Badge>
                          ) : (
                            <Badge bg="light" text="dark">Standard</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                </div>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}

      {activeTab === "areas" ? (
        <>
          {areaError ? <Alert variant="danger">{areaError}</Alert> : null}
          {areaMessage ? <Alert variant="success">{areaMessage}</Alert> : null}

          <Row className="g-3 mb-4">
            <Col xs={12} md={4}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">All areas</div>
                  <div className="h4 mb-0">{summary.total}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Configured</div>
                  <div className="h4 mb-0">{summary.configured}</div>
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} md={4}>
              <Card border="light" className="shadow-sm h-100">
                <Card.Body>
                  <div className="text-muted small">Metadata required</div>
                  <div className="h4 mb-0">{summary.pending}</div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card border="light" className="shadow-sm">
            <Card.Header>
              <div className="d-flex flex-wrap justify-content-between align-items-center" style={{ gap: 12 }}>
                <div>
                  <h5 className="mb-1">Area metadata</h5>
                  <div className="text-muted small">
                    Baseline workbook mappings stay read-only. Admin changes are stored as runtime organisation metadata.
                  </div>
                </div>
                <Button type="button" variant="outline-primary" size="sm" onClick={loadAreas} disabled={loadingAreas}>
                  {loadingAreas ? <><Spinner size="sm" className="me-2" /> Refreshing…</> : "Refresh"}
                </Button>
              </div>
            </Card.Header>

            <Card.Body>
              <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-end mb-3" style={{ gap: 12 }}>
                <Form.Group className="mobile-min-width-0" style={{ minWidth: 240, flex: "1 1 320px" }}>
                  <Form.Label>Search areas</Form.Label>
                  <Form.Control
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Area, section, code or added by"
                  />
                </Form.Group>

                <div className="d-flex flex-column flex-sm-row" style={{ gap: 8 }}>
                  <Button
                    type="button"
                    size="sm"
                    variant={!pendingOnly ? "primary" : "outline-primary"}
                    onClick={() => setAdministrationQuery("areas", false)}
                  >
                    All areas
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={pendingOnly ? "warning" : "outline-warning"}
                    onClick={() => setAdministrationQuery("areas", true)}
                  >
                    Metadata required ({summary.pending})
                  </Button>
                </div>
              </div>

              {loadingAreas && areas.length === 0 ? (
                <div className="text-center py-5">
                  <Spinner animation="border" role="status" />
                  <div className="text-muted mt-2">Loading area metadata…</div>
                </div>
              ) : visibleAreas.length === 0 ? (
                <Alert variant="info" className="mb-0">
                  No areas match the current filter.
                </Alert>
              ) : (
                <div className="table-responsive">
                  <Table
                    hover
                    size="sm"
                    className="align-middle mb-0 mobile-wrap-table"
                    style={{ fontSize: "0.875rem", width: "100%" }}
                  >
                  <thead>
                    <tr>
                      <th className="px-2 py-2" style={{ width: "31%" }}>Area</th>
                      <th className="px-2 py-2" style={{ width: "16%" }}>Section</th>
                      <th className="px-2 py-2 text-nowrap" style={{ width: "8%" }}>F / First</th>
                      <th className="px-2 py-2 text-nowrap" style={{ width: "8%" }}>G / Second</th>
                      <th className="px-2 py-2" style={{ width: "15%" }}>Status</th>
                      <th className="px-2 py-2" style={{ width: "14%" }}>Added by</th>
                      <th className="px-2 py-2 text-end" style={{ width: "8%" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAreas.map((area) => (
                      <tr key={area.area}>
                        <td className="px-2 py-2" style={{ overflowWrap: "anywhere" }}>
                          <div className="fw-bold">{area.area}</div>
                          {area.baseArea ? <div className="text-muted small">{area.baseArea}</div> : null}
                        </td>
                        <td className="px-2 py-2" style={{ overflowWrap: "anywhere" }}>{area.section || "—"}</td>
                        <td className="px-2 py-2">{area.first || "—"}</td>
                        <td className="px-2 py-2">{area.second || "—"}</td>
                        <td className="px-2 py-2">
                          {area.status === "CONFIGURED" ? (
                            <Badge bg="success">Configured</Badge>
                          ) : (
                            <Badge bg="warning" text="dark">Metadata required</Badge>
                          )}
                          <div className="text-muted small mt-1">{sourceLabel(area)}</div>
                        </td>
                        <td className="px-2 py-2" style={{ overflowWrap: "anywhere" }}>
                          {area.addedBy || "—"}
                          {area.updatedBy ? (
                            <div className="text-muted small">Updated by {area.updatedBy}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-end">
                          <Button
                            type="button"
                            size="sm"
                            variant={area.status === "PENDING" ? "primary" : "outline-primary"}
                            onClick={() => openEditor(area)}
                          >
                            {area.status === "PENDING" ? "Configure" : "Edit"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                </div>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}

      <Modal
        show={Boolean(userToDelete)}
        onHide={() => {
          if (!userActionId) setUserToDelete(null);
        }}
        centered
      >
        <Modal.Header closeButton={!userActionId}>
          <Modal.Title>Remove user</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            Remove <strong>{userToDelete?.name || userToDelete?.email || "this user"}</strong> from CRA?
          </p>
          <div className="text-muted small">
            This deletes the user account record. It does not remove historical reports or other records that may reference the user.
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="button"
            variant="outline-secondary"
            disabled={Boolean(userActionId)}
            onClick={() => setUserToDelete(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={Boolean(userActionId)}
            onClick={confirmDeleteUser}
          >
            {userActionId ? <><Spinner size="sm" className="me-2" /> Removing…</> : "Remove user"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(editingArea)} onHide={closeEditor} centered>
        <Form onSubmit={saveMetadata}>
          <Modal.Header closeButton={!saving}>
            <Modal.Title>Configure area metadata</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {saveError ? <Alert variant="danger">{saveError}</Alert> : null}

            <Form.Group className="mb-3">
              <Form.Label>Area name</Form.Label>
              <Form.Control value={editingArea?.area || ""} readOnly />
              <Form.Text className="text-muted">
                Area rename/delete is intentionally not available in this first Administration pass.
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Section</Form.Label>
              <Form.Select
                value={form.section}
                onChange={(event) => updateFormField("section", event.currentTarget.value)}
                required
              >
                <option value="">Select a section</option>
                {sections.map((section) => (
                  <option value={section} key={section}>{section}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Base area</Form.Label>
              <Form.Control
                value={form.baseArea}
                onChange={(event) => updateFormField("baseArea", event.currentTarget.value)}
                maxLength={160}
                placeholder="Optional base area description"
              />
            </Form.Group>

            <Row className="g-3">
              <Col xs={12} md={6}>
                <Form.Group>
                  <Form.Label>F / First code</Form.Label>
                  <Form.Control
                    value={form.first}
                    onChange={(event) => updateFormField("first", event.currentTarget.value)}
                    maxLength={40}
                    placeholder="Optional"
                  />
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group>
                  <Form.Label>G / Second code</Form.Label>
                  <Form.Control
                    value={form.second}
                    onChange={(event) => updateFormField("second", event.currentTarget.value)}
                    maxLength={40}
                    placeholder="Optional"
                  />
                </Form.Group>
              </Col>
            </Row>

            {editingArea?.status === "PENDING" ? (
              <Alert variant="warning" className="mt-3 mb-0">
                Servicing remains available while this metadata is pending. Until configured, future reports may continue to use the Unmapped folder.
              </Alert>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="outline-secondary" onClick={closeEditor} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? <><Spinner size="sm" className="me-2" /> Saving…</> : "Save metadata"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
