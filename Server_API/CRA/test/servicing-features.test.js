const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const checklist = require(path.join("..", "data", "templates", "full_manual_checklist_questions.json"));
const conveyorChecklist = require(path.join("..", "data", "templates", "conveyor_system_checklist_questions.json"));
const {
  normalizeYesNoChoice,
  normalizeLinearHeatType,
  requiresFeature,
  filterServicingResponses
} = require("../lib/servicingFeatures");

test("substation NFPA 72 ASD questions are explicitly tagged", () => {
  const asdQuestions = [];

  for (const [frequency, groups] of Object.entries(checklist)) {
    if (frequency === "general") continue;
    const questions = Array.isArray(groups?.["NFPA 72"]) ? groups["NFPA 72"] : [];

    for (const question of questions) {
      if (/\bASD\b/i.test(String(question?.question || ""))) {
        asdQuestions.push({ frequency, ...question });
      }
    }
  }

  assert.equal(asdQuestions.length, 6);
  asdQuestions.forEach((question) => {
    assert.equal(String(question.requiresFeature || "").toUpperCase(), "ASD");
    assert.equal(requiresFeature(question, "ASD"), true);
  });
});

test("ASD responses are removed when the serviced system has no ASD", () => {
  const responses = [
    { question: "Panel shows NORMAL", standard: "NFPA 72" },
    {
      question: "ASD sampling points visually unobstructed (walk-by)",
      standard: "NFPA 72",
      requiresFeature: "ASD"
    },
    {
      question: "Check ASD airflow and thresholds",
      standard: "NFPA 72"
    },
    { question: "Cylinder pressure indication in normal range", standard: "NFPA 2001" }
  ];

  const filtered = filterServicingResponses(responses, { asdInstalled: false });

  assert.deepEqual(
    filtered.map((item) => item.question),
    [
      "Panel shows NORMAL",
      "Cylinder pressure indication in normal range"
    ]
  );
});

test("ASD responses remain for ASD systems and legacy drafts without a selection", () => {
  const responses = [
    { question: "ASD filter condition checked", requiresFeature: "ASD" },
    { question: "Housekeeping: access clear" }
  ];

  assert.equal(filterServicingResponses(responses, { asdInstalled: true }).length, 2);
  assert.equal(filterServicingResponses(responses, {}).length, 2);
  assert.equal(normalizeYesNoChoice("No"), "no");
  assert.equal(normalizeYesNoChoice("YES"), "yes");
});


test("conveyor NFPA 72 fibre linear heat questions have standard alternatives", () => {
  const fibreRows = [];

  for (const [frequency, groups] of Object.entries(conveyorChecklist)) {
    if (frequency === "general") continue;
    const questions = Array.isArray(groups?.["NFPA 72"]) ? groups["NFPA 72"] : [];

    for (const question of questions) {
      if (String(question?.requiresFeature || "").toUpperCase() === "FIBER_LINEAR_HEAT") {
        fibreRows.push({ frequency, ...question });
      }
    }
  }

  assert.equal(fibreRows.length, 10);

  fibreRows.forEach((row) => {
    assert.equal(requiresFeature(row, "FIBER_LINEAR_HEAT"), true);
    const standard = row?.variants?.STANDARD_LINEAR_HEAT;
    assert.ok(standard && typeof standard === "object");
    assert.ok(String(standard.question || "").trim());
    assert.equal(/FiberSystem|Thermocable|ProReact|DiMM/i.test(String(standard.question || "")), false);
  });
});

test("linear heat response filtering keeps only the selected conveyor type", () => {
  const responses = [
    { question: "Panel shows NORMAL", standard: "NFPA 72" },
    {
      question: "FiberSystem 8000 controller healthy; no relay fault.",
      standard: "NFPA 72",
      requiresFeature: "FIBER_LINEAR_HEAT"
    },
    {
      question: "Standard linear heat interface unit healthy; no circuit fault indication.",
      standard: "NFPA 72",
      requiresFeature: "STANDARD_LINEAR_HEAT"
    }
  ];

  const fibre = filterServicingResponses(responses, { linearHeatType: "fiber" });
  assert.deepEqual(
    fibre.map((item) => item.question),
    [
      "Panel shows NORMAL",
      "FiberSystem 8000 controller healthy; no relay fault."
    ]
  );

  const standard = filterServicingResponses(responses, { linearHeatType: "standard" });
  assert.deepEqual(
    standard.map((item) => item.question),
    [
      "Panel shows NORMAL",
      "Standard linear heat interface unit healthy; no circuit fault indication."
    ]
  );

  assert.equal(normalizeLinearHeatType("fibre"), "fiber");
  assert.equal(normalizeLinearHeatType("STANDARD_LINEAR_HEAT"), "standard");
});

test("legacy fibre wording is defensively removed from standard linear heat payloads", () => {
  const responses = [
    { question: "Accessible fibre optic sensor cable route and supports intact.", standard: "NFPA 72" },
    { question: "Housekeeping satisfactory.", standard: "NFPA 72" }
  ];

  const filtered = filterServicingResponses(responses, { linearHeatType: "standard" });
  assert.deepEqual(filtered.map((item) => item.question), ["Housekeeping satisfactory."]);
});
