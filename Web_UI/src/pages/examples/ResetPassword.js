import React, { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleLeft, faUnlockAlt } from "@fortawesome/free-solid-svg-icons";
import { Col, Row, Form, Card, Button, Container, InputGroup, Alert, Spinner } from "@themesberg/react-bootstrap";
import { Link } from "react-router-dom";

import { Routes } from "../../routes";

export default function ResetPassword() {
  const authToken = localStorage.getItem("authToken") || "";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const canSubmit = useMemo(() => {
    if (!authToken) return false;
    if (!currentPassword) return false;
    if (!newPassword || newPassword.length < 8) return false;
    if (newPassword !== confirmNewPassword) return false;
    return true;
  }, [authToken, currentPassword, newPassword, confirmNewPassword]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setOkMsg("");

    if (!authToken) {
      setErr("You are not logged in. Please sign in again.");
      return;
    }

    if (!currentPassword) {
      setErr("Please enter your current password.");
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setErr("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setErr("New password and confirmation do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/profile/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Reset failed (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }

      setOkMsg("Password updated successfully. Redirecting to sign in…");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");

      // ✅ Force re-login after password change
      localStorage.removeItem("authToken");
      localStorage.removeItem("authUser");

      setLoading(false);

      // ✅ Redirect to Sign in (HashRouter)
      setTimeout(() => {
        window.location.hash = Routes.Signin.path;
      }, 800);
    } catch {
      setErr("Reset failed (API not reachable).");
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="bg-soft d-flex align-items-center my-5 mt-lg-6 mb-lg-5">
        <Container>
          <Row className="justify-content-center">
            <p className="text-center">
              <Card.Link as={Link} to={authToken ? Routes.Settings.path : Routes.Signin.path} className="text-gray-700">
                <FontAwesomeIcon icon={faAngleLeft} className="me-2" />
                {authToken ? "Back to settings" : "Back to sign in"}
              </Card.Link>
            </p>

            <Col xs={12} className="d-flex align-items-center justify-content-center">
              <div className="bg-white shadow-soft border rounded border-light p-4 p-lg-5 w-100 fmxw-500">
                <h3 className="mb-3">Reset password</h3>

                {!authToken ? (
                  <Alert variant="warning">
                    You’re not logged in. Please{" "}
                    <Card.Link as={Link} to={Routes.Signin.path} className="fw-bold">
                      sign in
                    </Card.Link>{" "}
                    first.
                  </Alert>
                ) : null}

                {err ? <Alert variant="danger">{err}</Alert> : null}
                {okMsg ? <Alert variant="success">{okMsg}</Alert> : null}

                <Form onSubmit={onSubmit}>
                  <Form.Group id="currentPassword" className="mb-4">
                    <Form.Label>Current password</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faUnlockAlt} />
                      </InputGroup.Text>
                      <Form.Control
                        autoFocus
                        required
                        type="password"
                        placeholder="Current password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        disabled={loading || !authToken}
                      />
                    </InputGroup>
                  </Form.Group>

                  <Form.Group id="newPassword" className="mb-4">
                    <Form.Label>New password</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faUnlockAlt} />
                      </InputGroup.Text>
                      <Form.Control
                        required
                        type="password"
                        placeholder="New password (min 8 characters)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={loading || !authToken}
                      />
                    </InputGroup>
                  </Form.Group>

                  <Form.Group id="confirmNewPassword" className="mb-4">
                    <Form.Label>Confirm new password</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faUnlockAlt} />
                      </InputGroup.Text>
                      <Form.Control
                        required
                        type="password"
                        placeholder="Confirm new password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        disabled={loading || !authToken}
                      />
                    </InputGroup>
                  </Form.Group>

                  <Button variant="primary" type="submit" className="w-100" disabled={loading || !canSubmit}>
                    {loading ? (
                      <>
                        <Spinner size="sm" className="me-2" /> Updating…
                      </>
                    ) : (
                      "Reset password"
                    )}
                  </Button>
                </Form>
              </div>
            </Col>
          </Row>
        </Container>
      </section>
    </main>
  );
}