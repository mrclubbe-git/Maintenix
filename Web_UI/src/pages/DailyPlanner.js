import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDay, faCheckCircle, faPlus, faSave, faTrashAlt, faUserCheck } from "@fortawesome/free-solid-svg-icons";
import { Badge, Button, Card, Col, Form, Modal, Row, Spinner } from "@themesberg/react-bootstrap";

const STATUS_LABELS = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  WAITING: "Waiting",
  DONE: "Done"
};

const STATUS_HELP = {
  TODO: "New work and planned items",
  IN_PROGRESS: "Currently being handled",
  WAITING: "Blocked or waiting on input",
  DONE: "Completed for the day"
};

const COLOURS = ["yellow", "blue", "green", "pink", "purple", "orange"];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hashQueryDate() {
  try {
    const hash = window.location.hash || "";
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    const date = params.get("date") || "";
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
  } catch {
    return todayKey();
  }
}

function authHeaders(json = true) {
  const token = localStorage.getItem("authToken") || "";
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${token}`
  };
}

function safeUserLabel(user) {
  return user?.name || user?.email || "Unassigned";
}

function emptyForm(date) {
  return {
    id: "",
    date,
    startDate: date,
    title: "",
    description: "",
    status: "TODO",
    colour: "yellow",
    assigneeUserId: ""
  };
}

export default function DailyPlanner() {
  const [date] = useState(hashQueryDate());
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm(date));
  const [dragTaskId, setDragTaskId] = useState("");

  const statusKeys = useMemo(() => ["TODO", "IN_PROGRESS", "WAITING", "DONE"], []);
  const usersById = useMemo(() => {
    const out = {};
    users.forEach((u) => { out[String(u.id)] = u; });
    return out;
  }, [users]);

  async function fetchPlanner(nextDate = date) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/daily-planner?date=${encodeURIComponent(nextDate)}`, {
        headers: authHeaders(false)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to load daily planner.");
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setCanEdit(!!data.canEdit);

      if (data.canEdit) {
        const userRes = await fetch("/api/daily-planner/users", { headers: authHeaders(false) });
        const userData = await userRes.json().catch(() => ({}));
        if (userRes.ok && userData.ok) setUsers(Array.isArray(userData.users) ? userData.users : []);
      }
    } catch (err) {
      setError(err.message || "Failed to load daily planner.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlanner(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    const onPlannerUpdated = (event) => {
      const relatedTask = event?.detail?.relatedTask;
      if (relatedTask?.id) {
        setTasks((cur) => cur.map((t) => String(t.id) === String(relatedTask.id) ? relatedTask : t));
      }
      fetchPlanner(date);
    };

    window.addEventListener("dailyPlannerUpdated", onPlannerUpdated);
    return () => window.removeEventListener("dailyPlannerUpdated", onPlannerUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function openNew(status = "TODO") {
    setForm({ ...emptyForm(date), status });
    setShowModal(true);
  }

  function openEdit(task) {
    if (!canEdit) return;
    setForm({
      id: task.id || "",
      date: task.date || date,
      startDate: task.startDate || task.date || date,
      title: task.title || "",
      description: task.description || "",
      status: task.status || "TODO",
      colour: task.colour || "yellow",
      assigneeUserId: task.assigneeUserId || ""
    });
    setShowModal(true);
  }

  async function saveTask(e) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError("");
    try {
      const method = form.id ? "PATCH" : "POST";
      const url = form.id ? `/api/daily-planner/${encodeURIComponent(form.id)}` : "/api/daily-planner";
      const res = await fetch(url, {
        method,
        headers: authHeaders(true),
        body: JSON.stringify({ ...form, date: form.id ? (form.date || date) : date })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to save task.");
      setShowModal(false);
      await fetchPlanner(date);
      window.dispatchEvent(new Event("notificationsUpdated"));
    } catch (err) {
      setError(err.message || "Failed to save task.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!canEdit || !form.id) return;
    if (!window.confirm("Delete this planner task?")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/daily-planner/${encodeURIComponent(form.id)}`, {
        method: "DELETE",
        headers: authHeaders(false)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to delete task.");
      setShowModal(false);
      await fetchPlanner(date);
    } catch (err) {
      setError(err.message || "Failed to delete task.");
    } finally {
      setSaving(false);
    }
  }

  async function moveTask(taskId, status) {
    if (!canEdit || !taskId) return;
    const task = tasks.find((t) => String(t.id) === String(taskId));
    if (!task || task.status === status) return;
    const position = tasks.filter((t) => t.status === status).length;
    const optimistic = tasks.map((t) => String(t.id) === String(taskId) ? { ...t, status, position } : t);
    setTasks(optimistic);
    try {
      const res = await fetch(`/api/daily-planner/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ status, position })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to move task.");
      await fetchPlanner(date);
    } catch (err) {
      setError(err.message || "Failed to move task.");
      await fetchPlanner(date);
    }
  }

  async function acknowledgeTask(taskId) {
    setError("");
    try {
      const res = await fetch(`/api/daily-planner/${encodeURIComponent(taskId)}/ack`, {
        method: "POST",
        headers: authHeaders(false)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to acknowledge task.");
      setTasks((cur) => cur.map((t) => String(t.id) === String(taskId) ? data.task : t));
      window.dispatchEvent(new CustomEvent("notificationsUpdated", { detail: data }));
    } catch (err) {
      setError(err.message || "Failed to acknowledge task.");
    }
  }

  function tasksForStatus(status) {
    return tasks.filter((task) => task.status === status).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  }

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center py-4">
        <div>
          <h1 className="h3 mb-1">Daily Planner</h1>
          <p className="text-muted mb-0">Global interactive planner board. Notes stay visible until completed and removed.</p>
        </div>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {!canEdit ? <div className="alert alert-info py-2">Read-only access. Only ADMIN and L3 users can add, move, edit, assign, or delete planner tasks.</div> : null}

      {loading ? (
        <div className="text-center py-5"><Spinner animation="border" /> Loading planner…</div>
      ) : (
        <Row className="g-3 daily-planner-board">
          {statusKeys.map((status) => (
            <Col xs={12} xl={3} md={6} key={status}>
              <Card
                border="light"
                className="shadow-sm h-100 planner-column"
                onDragOver={(e) => canEdit && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  moveTask(dragTaskId || e.dataTransfer.getData("text/plain"), status);
                  setDragTaskId("");
                }}
              >
                <Card.Header className="d-flex justify-content-between align-items-center bg-white border-bottom">
                  <div>
                    <h2 className="h6 mb-0">{STATUS_LABELS[status]}</h2>
                    <small className="text-muted">{STATUS_HELP[status]}</small>
                  </div>
                  <Badge bg="secondary" pill>{tasksForStatus(status).length}</Badge>
                </Card.Header>
                <Card.Body className="planner-column-body">
                  {canEdit ? (
                    <Button variant="outline-primary" size="sm" className="w-100 mb-3" onClick={() => openNew(status)}>
                      <FontAwesomeIcon icon={faPlus} className="me-2" /> Add note
                    </Button>
                  ) : null}

                  {tasksForStatus(status).length === 0 ? (
                    <div className="planner-empty">Drop sticky notes here</div>
                  ) : null}

                  {tasksForStatus(status).map((task) => {
                    const assignee = usersById[task.assigneeUserId] || { name: task.assigneeName, email: task.assigneeEmail };
                    return (
                      <div
                        key={task.id}
                        className={`planner-sticky planner-${task.colour || "yellow"} ${canEdit ? "planner-draggable" : ""}`}
                        draggable={canEdit}
                        onDragStart={(e) => {
                          setDragTaskId(task.id);
                          e.dataTransfer.setData("text/plain", task.id);
                        }}
                        onClick={() => openEdit(task)}
                        role={canEdit ? "button" : "article"}
                      >
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <h3 className="planner-title">{task.title || "Untitled task"}</h3>
                          {task.assignmentAcknowledged ? <FontAwesomeIcon icon={faCheckCircle} className="text-success mt-1" title="Acknowledged" /> : null}
                        </div>
                        {task.description ? <p className="planner-description">{task.description}</p> : null}
                        {task.startDate ? (
                          <div className="planner-start-date"><FontAwesomeIcon icon={faCalendarDay} className="me-1" /> Starts: {task.startDate}</div>
                        ) : null}
                        <div className="planner-meta">
                          {task.assigneeUserId ? (
                            <span><FontAwesomeIcon icon={faUserCheck} className="me-1" /> {safeUserLabel(assignee)}</span>
                          ) : <span>Unassigned</span>}
                          {task.assigneeUserId && !task.assignmentAcknowledged ? <Badge bg="warning" text="dark">Pending ack</Badge> : null}
                        </div>
                        {task.assignedToMe && !task.acknowledgedByMe ? (
                          <Button
                            variant="success"
                            size="sm"
                            className="w-100 mt-3"
                            onClick={(e) => {
                              e.stopPropagation();
                              acknowledgeTask(task.id);
                            }}
                          >
                            Acknowledge allocation
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal as={Modal.Dialog} centered show={showModal} onHide={() => setShowModal(false)}>
        <Form onSubmit={saveTask}>
          <Modal.Header>
            <Modal.Title className="h6">{form.id ? "Edit planner task" : "New planner task"}</Modal.Title>
            <Button variant="close" aria-label="Close" onClick={() => setShowModal(false)} />
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control value={form.title} maxLength={140} required onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control as="textarea" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Starting date</Form.Label>
              <Form.Control type="date" value={form.startDate || date} onChange={(e) => setForm({ ...form, startDate: e.target.value || date })} />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Status</Form.Label>
                  <Form.Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {statusKeys.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Colour</Form.Label>
                  <Form.Select value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })}>
                    {COLOURS.map((colour) => <option key={colour} value={colour}>{colour.charAt(0).toUpperCase() + colour.slice(1)}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Form.Group>
              <Form.Label>Link user to task</Form.Label>
              <Form.Select value={form.assigneeUserId} onChange={(e) => setForm({ ...form, assigneeUserId: e.target.value })}>
                <option value="">Unassigned</option>
                {users.map((user) => <option key={user.id} value={user.id}>{safeUserLabel(user)} ({user.role})</option>)}
              </Form.Select>
              <Form.Text className="text-muted">When assigned, the user receives a required acknowledgement notification.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="d-flex justify-content-between">
            <div>
              {form.id ? (
                <Button variant="outline-danger" type="button" onClick={deleteTask} disabled={saving}>
                  <FontAwesomeIcon icon={faTrashAlt} className="me-2" /> Delete
                </Button>
              ) : null}
            </div>
            <div>
              <Button variant="link" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={saving}>
                <FontAwesomeIcon icon={faSave} className="me-2" /> {saving ? "Saving…" : "Save task"}
              </Button>
            </div>
          </Modal.Footer>
        </Form>
      </Modal>

      <style>{`
        .daily-planner-board { min-height: 64vh; }
        .planner-column { min-height: 64vh; border-radius: 16px; }
        .planner-column-body { background: #f5f7fb; border-radius: 0 0 16px 16px; min-height: 56vh; }
        .planner-empty { border: 2px dashed #d7deea; color: #8a94a6; border-radius: 14px; padding: 22px; text-align: center; font-size: 0.9rem; }
        .planner-sticky { border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 10px 24px rgba(31, 45, 61, 0.12); border: 1px solid rgba(31,45,61,0.08); transition: transform .15s ease, box-shadow .15s ease; white-space: pre-wrap; }
        .planner-draggable { cursor: grab; }
        .planner-draggable:active { cursor: grabbing; }
        .planner-draggable:hover { transform: translateY(-2px) rotate(-0.2deg); box-shadow: 0 14px 30px rgba(31, 45, 61, 0.18); }
        .planner-title { font-size: 1rem; line-height: 1.25; margin: 0 0 8px; font-weight: 700; }
        .planner-description { font-size: 0.88rem; color: #394457; margin-bottom: 14px; }
        .planner-start-date { color: #49566b; font-size: 0.78rem; font-weight: 700; margin: -4px 0 10px; }
        .planner-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: #596579; font-size: 0.78rem; }
        .planner-yellow { background: linear-gradient(145deg, #fff7b8, #ffe98a); }
        .planner-blue { background: linear-gradient(145deg, #d8ecff, #a9d5ff); }
        .planner-green { background: linear-gradient(145deg, #d9f8dc, #aef0b7); }
        .planner-pink { background: linear-gradient(145deg, #ffddea, #ffc0d6); }
        .planner-purple { background: linear-gradient(145deg, #eadfff, #d5c0ff); }
        .planner-orange { background: linear-gradient(145deg, #ffe4bf, #ffc978); }
      `}</style>
    </>
  );
}
