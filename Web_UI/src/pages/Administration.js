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
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
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
    tab: ["users", "areas", "site-logs", "system"].includes(tab) ? tab : "areas",
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

function logLevelVariant(value) {
  const level = String(value || "").toUpperCase();
  if (level === "CRITICAL") return "danger";
  if (level === "ERROR") return "danger";
  if (level === "WARN") return "warning";
  if (level === "INFO") return "info";
  return "secondary";
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

  const [systemStatus, setSystemStatus] = useState(null);
  const [loadingSystem, setLoadingSystem] = useState(false);
  const [systemError, setSystemError] = useState("");

  const [siteLogs, setSiteLogs] = useState([]);
  const [siteLogSummary, setSiteLogSummary] = useState({
    total: 0, info: 0, warn: 0, error: 0, critical: 0, users: 0, categories: []
  });
  const [loadingSiteLogs, setLoadingSiteLogs] = useState(false);
  const [siteLogError, setSiteLogError] = useState("");
  const [siteLogSearch, setSiteLogSearch] = useState("");
  const [siteLogLevel, setSiteLogLevel] = useState("");
  const [siteLogCategory, setSiteLogCategory] = useState("");
  const [siteLogHours, setSiteLogHours] = useState("24");
  const [selectedSiteLog, setSelectedSiteLog] = useState(null);

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

  const loadSystem = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingSystem(true);
    setSystemError("");
    try {
      const data = await apiRequest("/api/server/status");
      setSystemStatus(data);
    } catch (error) {
      setSystemError(String(error?.message || "Unable to load system status."));
    } finally {
      setLoadingSystem(false);
    }
  }, [isAdmin]);

  const loadSiteLogs = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingSiteLogs(true);
    setSiteLogError("");

    try {
      const params = new URLSearchParams();
      params.set("hours", siteLogHours || "24");
      params.set("limit", "250");
      if (siteLogLevel) params.set("level", siteLogLevel);
      if (siteLogCategory) params.set("category", siteLogCategory);
      if (String(siteLogSearch || "").trim()) params.set("search", String(siteLogSearch).trim());

      const data = await apiRequest(`/api/admin/site-logs?${params.toString()}`);
      setSiteLogs(Array.isArray(data?.logs) ? data.logs : []);
      setSiteLogSummary({
        total: Number(data?.summary?.total || 0),
        info: Number(data?.summary?.info || 0),
        warn: Number(data?.summary?.warn || 0),
        error: Number(data?.summary?.error || 0),
        critical: Number(data?.summary?.critical || 0),
        users: Number(data?.summary?.users || 0),
        categories: Array.isArray(data?.summary?.categories) ? data.summary.categories : []
      });
    } catch (error) {
      setSiteLogError(String(error?.message || "Unable to load Site Logs."));
    } finally {
      setLoadingSiteLogs(false);
    }
  }, [isAdmin, siteLogCategory, siteLogHours, siteLogLevel, siteLogSearch]);

  useEffect(() => {
    if (activeTab === "users") loadUsers();
  }, [activeTab, loadUsers]);

  useEffect(() => {
    if (activeTab === "areas") loadAreas();
  }, [activeTab, loadAreas]);

  useEffect(() => {
    if (activeTab === "system") loadSystem();
  }, [activeTab, loadSystem]);

  useEffect(() => {
    if (activeTab === "site-logs") loadSiteLogs();
  }, [activeTab, loadSiteLogs]);

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
            Manage organisation users, area metadata, Site Logs and system status.
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
              <Nav.Link eventKey="site-logs">Site Logs</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="system">System</Nav.Link>
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
              <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-end mb-3 admin-mobile-stack-row" style={{ gap: 12 }}>
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
                <>
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
                </>
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
              <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-end mb-3 admin-mobile-stack-row" style={{ gap: 12 }}>
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
                <>
                <div className="table-responsive d-none d-md-block">
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

                <div className="d-md-none">
                  {visibleAreas.map((area) => (
                    <Card key={area.area} border="light" className="shadow-sm mb-3">
                      <Card.Body>
                        <div className="d-flex flex-column" style={{ gap: 12 }}>
                          <div className="mobile-break-anywhere">
                            <div className="fw-bold mobile-break-anywhere">{area.area}</div>
                            {area.baseArea ? (
                              <div className="text-muted small mobile-break-anywhere">{area.baseArea}</div>
                            ) : null}
                          </div>

                          <div>
                            <div className="text-muted small">Section</div>
                            <div className="mobile-break-anywhere">{area.section || "—"}</div>
                          </div>

                          <div>
                            <div className="text-muted small">F / First</div>
                            <div>{area.first || "—"}</div>
                          </div>

                          <div>
                            <div className="text-muted small">G / Second</div>
                            <div>{area.second || "—"}</div>
                          </div>

                          <div>
                            <div className="text-muted small mb-1">Status</div>
                            {area.status === "CONFIGURED" ? (
                              <Badge bg="success">Configured</Badge>
                            ) : (
                              <Badge bg="warning" text="dark">Metadata required</Badge>
                            )}
                            <div className="text-muted small mt-1">{sourceLabel(area)}</div>
                          </div>

                          <div className="mobile-break-anywhere">
                            <div className="text-muted small">Added by</div>
                            <div className="mobile-break-anywhere">{area.addedBy || "—"}</div>
                            {area.updatedBy ? (
                              <div className="text-muted small mobile-break-anywhere">Updated by {area.updatedBy}</div>
                            ) : null}
                          </div>

                          <Button
                            type="button"
                            size="sm"
                            className="w-100"
                            variant={area.status === "PENDING" ? "primary" : "outline-primary"}
                            onClick={() => openEditor(area)}
                          >
                            {area.status === "PENDING" ? "Configure" : "Edit"}
                          </Button>
                        </div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
                </>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}

      {activeTab === "site-logs" ? (
        <>
          {siteLogError ? <Alert variant="danger">{siteLogError}</Alert> : null}

          <Row className="g-3 mb-4">
            <Col xs={12} sm={6} xl={3}>
              <Card border="light" className="shadow-sm h-100"><Card.Body>
                <div className="text-muted small">Errors</div>
                <div className="h4 mb-0">{siteLogSummary.error + siteLogSummary.critical}</div>
              </Card.Body></Card>
            </Col>
            <Col xs={12} sm={6} xl={3}>
              <Card border="light" className="shadow-sm h-100"><Card.Body>
                <div className="text-muted small">Warnings</div>
                <div className="h4 mb-0">{siteLogSummary.warn}</div>
              </Card.Body></Card>
            </Col>
            <Col xs={12} sm={6} xl={3}>
              <Card border="light" className="shadow-sm h-100"><Card.Body>
                <div className="text-muted small">Activity</div>
                <div className="h4 mb-0">{siteLogSummary.total}</div>
              </Card.Body></Card>
            </Col>
            <Col xs={12} sm={6} xl={3}>
              <Card border="light" className="shadow-sm h-100"><Card.Body>
                <div className="text-muted small">Users</div>
                <div className="h4 mb-0">{siteLogSummary.users}</div>
              </Card.Body></Card>
            </Col>
          </Row>

          <Card border="light" className="shadow-sm">
            <Card.Header>
              <div className="d-flex flex-wrap justify-content-between align-items-center" style={{ gap: 12 }}>
                <div>
                  <h5 className="mb-1">Site Logs</h5>
                  <div className="text-muted small">
                    User activity, browser errors, API failures and security-relevant events. Sensitive credentials and payload contents are not recorded.
                  </div>
                </div>
                <Button type="button" variant="outline-primary" size="sm" onClick={loadSiteLogs} disabled={loadingSiteLogs}>
                  {loadingSiteLogs ? <><Spinner size="sm" className="me-2" /> Refreshing…</> : "Refresh"}
                </Button>
              </div>
            </Card.Header>

            <Card.Body>
              <Row className="g-3 mb-3">
                <Col xs={12} lg={5}>
                  <Form.Group>
                    <Form.Label>Search</Form.Label>
                    <Form.Control
                      type="search"
                      value={siteLogSearch}
                      onChange={(event) => setSiteLogSearch(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          loadSiteLogs();
                        }
                      }}
                      placeholder="Message, event, request ID, area or user"
                    />
                  </Form.Group>
                </Col>
                <Col xs={12} sm={4} lg={2}>
                  <Form.Group>
                    <Form.Label>Level</Form.Label>
                    <Form.Select value={siteLogLevel} onChange={(event) => setSiteLogLevel(event.currentTarget.value)}>
                      <option value="">All levels</option>
                      <option value="INFO">INFO</option>
                      <option value="WARN">WARN</option>
                      <option value="ERROR">ERROR</option>
                      <option value="CRITICAL">CRITICAL</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col xs={12} sm={4} lg={3}>
                  <Form.Group>
                    <Form.Label>Module</Form.Label>
                    <Form.Select value={siteLogCategory} onChange={(event) => setSiteLogCategory(event.currentTarget.value)}>
                      <option value="">All modules</option>
                      {(siteLogSummary.categories || []).map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col xs={12} sm={4} lg={2}>
                  <Form.Group>
                    <Form.Label>Period</Form.Label>
                    <Form.Select value={siteLogHours} onChange={(event) => setSiteLogHours(event.currentTarget.value)}>
                      <option value="24">Last 24 hours</option>
                      <option value="168">Last 7 days</option>
                      <option value="720">Last 30 days</option>
                      <option value="2160">Last 90 days</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>

              {loadingSiteLogs && siteLogs.length === 0 ? (
                <div className="text-center py-5">
                  <Spinner animation="border" role="status" />
                  <div className="text-muted mt-2">Loading Site Logs…</div>
                </div>
              ) : siteLogs.length === 0 ? (
                <Alert variant="info" className="mb-0">No Site Logs match the current filters.</Alert>
              ) : (
                <>
                  <div className="table-responsive d-none d-md-block">
                    <Table hover size="sm" className="align-middle mb-0" style={{ fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Level</th>
                          <th>User</th>
                          <th>Module</th>
                          <th>Event</th>
                          <th>Message</th>
                          <th className="text-end">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteLogs.map((entry) => (
                          <tr key={entry.id}>
                            <td style={{ whiteSpace: "nowrap" }}>{formatAdminDate(entry.timestamp)}</td>
                            <td>
                              <Badge bg={logLevelVariant(entry.level)} text={entry.level === "WARN" ? "dark" : undefined}>
                                {entry.level || "INFO"}
                              </Badge>
                            </td>
                            <td style={{ overflowWrap: "anywhere" }}>
                              <div>{entry?.user?.name || entry?.user?.email || "—"}</div>
                              {entry?.user?.role ? <div className="text-muted small">{entry.user.role}</div> : null}
                            </td>
                            <td>{entry.category || "—"}</td>
                            <td style={{ overflowWrap: "anywhere" }}>{entry.event || "—"}</td>
                            <td style={{ minWidth: 220, overflowWrap: "anywhere" }}>{entry.message || "—"}</td>
                            <td className="text-end">
                              <Button type="button" size="sm" variant="outline-primary" onClick={() => setSelectedSiteLog(entry)}>
                                View
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>

                  <div className="d-md-none">
                    {siteLogs.map((entry) => (
                      <Card key={entry.id} border="light" className="shadow-sm mb-3">
                        <Card.Body>
                          <div className="d-flex justify-content-between align-items-start" style={{ gap: 12 }}>
                            <div className="mobile-min-width-0">
                              <div className="fw-bold mobile-break-anywhere">{entry.event || "Site event"}</div>
                              <div className="text-muted small">{formatAdminDate(entry.timestamp)}</div>
                            </div>
                            <Badge bg={logLevelVariant(entry.level)} text={entry.level === "WARN" ? "dark" : undefined}>
                              {entry.level || "INFO"}
                            </Badge>
                          </div>
                          <div className="mt-3 small">
                            <div><strong>Module:</strong> {entry.category || "—"}</div>
                            <div className="mobile-break-anywhere"><strong>User:</strong> {entry?.user?.name || entry?.user?.email || "—"}</div>
                            <div className="mt-2 mobile-break-anywhere">{entry.message || "—"}</div>
                          </div>
                          <Button type="button" size="sm" variant="outline-primary" className="w-100 mt-3" onClick={() => setSelectedSiteLog(entry)}>
                            View details
                          </Button>
                        </Card.Body>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}

      {activeTab === "system" ? (
        <>
          {systemError ? <Alert variant="danger">{systemError}</Alert> : null}
          <Card border="light" className="shadow-sm">
            <Card.Header>
              <div className="d-flex flex-wrap justify-content-between align-items-center" style={{ gap: 12 }}>
                <div>
                  <h5 className="mb-1">System status</h5>
                  <div className="text-muted small">Read-only service, host, CPU and storage information.</div>
                </div>
                <Button type="button" variant="outline-primary" size="sm" onClick={loadSystem} disabled={loadingSystem}>
                  {loadingSystem ? <><Spinner size="sm" className="me-2" /> Refreshing…</> : "Refresh"}
                </Button>
              </div>
            </Card.Header>
            <Card.Body>
              {loadingSystem && !systemStatus ? (
                <div className="text-center py-4">
                  <Spinner animation="border" role="status" />
                  <div className="text-muted mt-2">Loading system status…</div>
                </div>
              ) : systemStatus ? (
                <Row className="g-3">
                  <Col xs={12} md={6} xl={3}>
                    <Card border="light" className="h-100">
                      <Card.Body>
                        <div className="text-muted small">Service</div>
                        <div className="fw-bold mobile-break-anywhere">{systemStatus.service || "Maintenix CRA API"}</div>
                        <div className="text-muted small mt-2">Host</div>
                        <div className="mobile-break-anywhere">{systemStatus.host || "—"}</div>
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col xs={12} md={6} xl={3}>
                    <Card border="light" className="h-100">
                      <Card.Body>
                        <div className="text-muted small">CPU usage</div>
                        <div className="h4 mb-0">{Number(systemStatus.cpuUsagePercent || 0).toFixed(1)}%</div>
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col xs={12} md={6} xl={3}>
                    <Card border="light" className="h-100">
                      <Card.Body>
                        <div className="text-muted small">Storage used</div>
                        <div className="h4 mb-0">{Number(systemStatus.storageUsedPercent || 0).toFixed(1)}%</div>
                        <div className="text-muted small">{Number(systemStatus.storageFreeGB || 0)} GB free</div>
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col xs={12} md={6} xl={3}>
                    <Card border="light" className="h-100">
                      <Card.Body>
                        <div className="text-muted small">API process uptime</div>
                        <div className="h4 mb-0">{Math.floor(Number(systemStatus.processUptimeSeconds || 0) / 3600)}h</div>
                        <div className="text-muted small">Read-only telemetry</div>
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>
              ) : (
                <Alert variant="info" className="mb-0">System status has not been loaded yet.</Alert>
              )}
            </Card.Body>
          </Card>
        </>
      ) : null}

      <Modal
        show={Boolean(selectedSiteLog)}
        onHide={() => setSelectedSiteLog(null)}
        size="lg"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Site Log details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedSiteLog ? (
            <>
              <Row className="g-3 mb-3">
                <Col xs={12} md={6}>
                  <div className="text-muted small">Timestamp</div>
                  <div>{formatAdminDate(selectedSiteLog.timestamp)}</div>
                </Col>
                <Col xs={12} md={3}>
                  <div className="text-muted small">Level</div>
                  <Badge bg={logLevelVariant(selectedSiteLog.level)} text={selectedSiteLog.level === "WARN" ? "dark" : undefined}>
                    {selectedSiteLog.level || "INFO"}
                  </Badge>
                </Col>
                <Col xs={12} md={3}>
                  <div className="text-muted small">Module</div>
                  <div>{selectedSiteLog.category || "—"}</div>
                </Col>
                <Col xs={12} md={6}>
                  <div className="text-muted small">User</div>
                  <div className="mobile-break-anywhere">
                    {selectedSiteLog?.user?.name || "—"} {selectedSiteLog?.user?.email ? `(${selectedSiteLog.user.email})` : ""}
                  </div>
                </Col>
                <Col xs={12} md={6}>
                  <div className="text-muted small">Request ID</div>
                  <div className="mobile-break-anywhere">{selectedSiteLog.requestId || "—"}</div>
                </Col>
                <Col xs={12}>
                  <div className="text-muted small">Event</div>
                  <div className="fw-bold mobile-break-anywhere">{selectedSiteLog.event || "—"}</div>
                  <div className="mt-1 mobile-break-anywhere">{selectedSiteLog.message || "—"}</div>
                </Col>
              </Row>

              <div className="text-muted small mb-1">Technical details</div>
              <pre
                className="bg-light border rounded p-3 mb-0"
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.78rem", maxHeight: 360, overflowY: "auto" }}
              >
                {JSON.stringify({
                  route: selectedSiteLog.route || "",
                  method: selectedSiteLog.method || "",
                  status: selectedSiteLog.status,
                  area: selectedSiteLog.area || "",
                  entityId: selectedSiteLog.entityId || "",
                  appVersion: selectedSiteLog.appVersion || "",
                  apiVersion: selectedSiteLog.apiVersion || "",
                  device: selectedSiteLog.device || null,
                  details: selectedSiteLog.details || null
                }, null, 2)}
              </pre>
            </>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" onClick={() => setSelectedSiteLog(null)}>Close</Button>
        </Modal.Footer>
      </Modal>

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
