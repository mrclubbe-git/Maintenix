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

function mappingDiagnostic(area) {
  if (area?.status === "CONFIGURED") {
    if (area?.source === "RUNTIME") return "Runtime Admin mapping";
    return "Baseline mapping";
  }

  const diagnostics = area?.diagnostics || {};
  if (diagnostics.matched && diagnostics.resolvedSection && diagnostics.resolvedSection !== "Unmapped") {
    return `Current resolver suggests ${diagnostics.resolvedSection} (${diagnostics.reason || "fuzzy"}), but explicit metadata is still required.`;
  }

  return "Future reports use Unmapped until metadata is configured.";
}

export default function Administration() {
  const history = useHistory();
  const location = useLocation();
  const authUser = readAuthUser();
  const isAdmin = String(authUser?.role || "").trim().toUpperCase() === "ADMIN";

  const initial = queryState(location.search);
  const [activeTab, setActiveTab] = useState(initial.tab);
  const [pendingOnly, setPendingOnly] = useState(initial.pendingOnly);
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
    if (activeTab === "areas") loadAreas();
  }, [activeTab, loadAreas]);

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
        <Card.Body className="pb-0">
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
        <Card border="light" className="shadow-sm">
          <Card.Body>
            <h5>Users</h5>
            <p className="text-muted mb-0">
              Existing Admin user-management APIs remain unchanged. Their permanent Administration UI will be migrated into this tab next.
            </p>
          </Card.Body>
        </Card>
      ) : null}

      {activeTab === "notifications" ? (
        <Card border="light" className="shadow-sm">
          <Card.Body>
            <h5>Notifications</h5>
            <p className="text-muted mb-0">
              Notification event configuration will live here in a future Administration phase. The centralized notification registry remains the current source of truth.
            </p>
          </Card.Body>
        </Card>
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
              <div className="d-flex flex-wrap align-items-end mb-3" style={{ gap: 12 }}>
                <Form.Group style={{ minWidth: 240, flex: "1 1 320px" }}>
                  <Form.Label>Search areas</Form.Label>
                  <Form.Control
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Area, section, code or added by"
                  />
                </Form.Group>

                <div className="d-flex flex-wrap" style={{ gap: 8 }}>
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
                  <Table hover className="align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Section</th>
                        <th>F / First</th>
                        <th>G / Second</th>
                        <th>Status</th>
                        <th>Added by</th>
                        <th>Mapping diagnostics</th>
                        <th className="text-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAreas.map((area) => (
                        <tr key={area.area}>
                          <td>
                            <div className="fw-bold">{area.area}</div>
                            {area.baseArea ? <div className="text-muted small">{area.baseArea}</div> : null}
                          </td>
                          <td>{area.section || "—"}</td>
                          <td>{area.first || "—"}</td>
                          <td>{area.second || "—"}</td>
                          <td>
                            {area.status === "CONFIGURED" ? (
                              <Badge bg="success">Configured</Badge>
                            ) : (
                              <Badge bg="warning" text="dark">Metadata required</Badge>
                            )}
                            <div className="text-muted small mt-1">{sourceLabel(area)}</div>
                          </td>
                          <td>
                            {area.addedBy || "—"}
                            {area.updatedBy ? (
                              <div className="text-muted small">Updated by {area.updatedBy}</div>
                            ) : null}
                          </td>
                          <td style={{ minWidth: 220 }}>
                            <div className="small">{mappingDiagnostic(area)}</div>
                          </td>
                          <td className="text-end">
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
                onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))}
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
                onChange={(event) => setForm((current) => ({ ...current, baseArea: event.target.value }))}
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
                    onChange={(event) => setForm((current) => ({ ...current, first: event.target.value }))}
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
                    onChange={(event) => setForm((current) => ({ ...current, second: event.target.value }))}
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
