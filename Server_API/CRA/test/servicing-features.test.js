const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const checklist = require(path.join("..", "data", "templates", "full_manual_checklist_questions.json"));
const {
  normalizeYesNoChoice,
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
