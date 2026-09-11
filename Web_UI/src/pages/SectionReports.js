import React, { useEffect, useRef } from "react";
import { Redirect } from "react-router-dom";
import { Routes } from "../routes";
import initializeFormalReporting from "./formalReportingController";

const pageMarkup = `
  <header class="d-flex justify-content-between flex-wrap align-items-center py-4 gap-3">
    <div><h4 class="mb-0">Section Reports</h4><small class="text-muted">Section reporting workflow (Setup → Questionnaire → Review)</small></div>
  </header>
  <main class="formal-reports-content">
    <section class="card border-light shadow-sm mb-3">
      <div class="card-body">
        <div class="progress" role="progressbar" aria-label="Report completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="33" style="height:20px">
          <div id="workflow-progress-bar" class="progress-bar" style="width:33%">33%</div>
        </div>
      </div>
    </section>
    <section class="card border-light shadow-sm mb-3 drafts-panel">
      <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2"><div class="fw-bold">Saved Drafts</div><div id="draft-count" class="text-muted small">0 draft(s)</div></div>
      <div class="card-body">
        <div id="drafts-list"><div class="text-muted small">Loading drafts…</div></div>
        <div class="text-muted small draft-help">Save the draft in the Review step. Queued generation will be added here in the next workflow step.</div>
      </div>
    </section>
    <div id="notice" class="notice hidden" role="status"></div>
    <section id="step-1" class="card border-light shadow-sm screen">
      <div class="card-header"><div><h5 class="mb-0">Create reporting cycle</h5><small class="text-muted">Step 1 of 3 · Choose the reporting area and service period.</small></div></div>
      <form id="setup-form" class="form-grid card-body">
        <label class="field field-wide"><span>Reporting section / area</span><select id="section" required><option value="">Select area</option></select><small id="system-count">Select an area to view its systems.</small></label>
        <label class="field"><span>Month</span><input id="month" type="month" required></label>
        <label class="field"><span>Calendar week number</span><select id="week" required><option value="">Select week</option></select><small id="week-range">Monday–Sunday date range will appear here.</small></label>
        <label class="field"><span>Compiled by</span><input id="compiled-name" type="text" autocomplete="name" placeholder="Name and surname" required></label>
        <label class="field"><span>Designation / position</span><input id="compiled-designation" type="text" placeholder="Designation or position" required></label>
        <div class="actions field-wide"><button class="btn btn-primary" type="submit">Start questionnaire</button></div>
      </form>
    </section>
    <section id="step-2" class="screen hidden">
      <div class="card border-light shadow-sm mb-3 questionnaire-header"><div><h5 id="questionnaire-title" class="mb-1">System questionnaire</h5><p id="questionnaire-period" class="text-muted mb-0"></p></div><div class="progress-copy"><strong id="progress-count">0 of 0 completed</strong><div class="progress-track"><span id="progress-bar"></span></div></div></div>
      <div id="systems-list" class="systems-list"></div>
      <div class="question-nav"><button id="previous-step" class="btn btn-outline-secondary" type="button">Previous</button><button id="next-review" class="btn btn-primary" type="button">Next: Review</button></div>
    </section>
    <section id="step-3" class="screen hidden">
      <div class="card border-light shadow-sm">
        <div class="card-header section-heading review-heading"><div><h5 class="mb-1">Review questionnaire</h5><p id="review-period" class="text-muted mb-0"></p></div><button id="back-to-systems" class="btn btn-outline-secondary btn-sm" type="button">Back to systems</button></div>
        <div class="card-body">
        <div class="summary-grid"><article><span>No defects</span><strong id="no-count">0</strong></article><article><span>Defects found</span><strong id="yes-count">0</strong></article><article><span>Unanswered</span><strong id="pending-count">0</strong></article></div>
        <div id="review-list" class="review-list"></div>
        <label class="final-confirmation"><input id="final-confirmation" type="checkbox"><span>I confirm that the questionnaire and report details are complete and may be issued as final.</span></label>
        <div id="generated-files" class="generated-files hidden"></div>
        <div class="actions review-actions"><button id="save-draft" class="btn btn-outline-secondary" type="button">Save draft</button><button id="generate-report" class="btn btn-primary" type="button" disabled>Generate final DOCX &amp; PDF</button></div>
        <p class="muted note">Final files are generated only after explicit confirmation.</p>
        </div>
      </div>
    </section>
  </main>`;

function currentRole() {
  try { return String(JSON.parse(localStorage.getItem("authUser") || "null")?.role || "").toUpperCase().replace(/\s+/g, ""); }
  catch { return ""; }
}

export default function FormalReports() {
  const hostRef = useRef(null);
  const isAdmin = currentRole() === "ADMIN";

  useEffect(() => {
    if (!isAdmin || !hostRef.current) return undefined;
    const host = hostRef.current;
    host.innerHTML = pageMarkup;
    const cleanup = initializeFormalReporting(host);
    return () => { if (typeof cleanup === "function") cleanup(); host.innerHTML = ""; };
  }, [isAdmin]);

  if (!isAdmin) return <Redirect to={Routes.DashboardOverview.path} />;
  return <div ref={hostRef} data-page="section-reports" />;
}
