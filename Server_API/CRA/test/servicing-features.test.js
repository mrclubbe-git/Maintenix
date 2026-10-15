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


function normalizeChecklistKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function effectiveQuestionKey(standard, question) {
  const explicit = normalizeChecklistKey(question?.dedupeKey);
  const std = normalizeChecklistKey(standard) || "general";
  if (explicit) return `${std}::group::${explicit}`;
  return `${std}::text::${normalizeChecklistKey(question?.question)}`;
}

function mergeCumulativeForTest(source, targetFrequency, standard) {
  const order = ["weekly", "monthly", "quarterly", "annual"];
  const end = Math.max(0, order.indexOf(targetFrequency));
  const merged = [];
  const indexByKey = new Map();

  for (const frequency of order.slice(0, end + 1)) {
    const questions = Array.isArray(source?.[frequency]?.[standard])
      ? source[frequency][standard]
      : [];

    for (const question of questions) {
      const key = effectiveQuestionKey(standard, question);
      const previousIndex = indexByKey.get(key);
      if (previousIndex !== undefined) {
        merged[previousIndex] = question;
        continue;
      }
      indexByKey.set(key, merged.length);
      merged.push(question);
    }
  }

  return merged;
}

test("cumulative servicing merge contains no duplicate logical checks", () => {
  const sources = [
    { name: "substation", data: checklist },
    { name: "conveyor", data: conveyorChecklist }
  ];

  for (const source of sources) {
    for (const targetFrequency of ["weekly", "monthly", "quarterly", "annual"]) {
      const standards = new Set();
      for (const frequency of ["weekly", "monthly", "quarterly", "annual"]) {
        Object.keys(source.data?.[frequency] || {}).forEach((standard) => standards.add(standard));
      }

      for (const standard of standards) {
        const merged = mergeCumulativeForTest(source.data, targetFrequency, standard);
        const keys = merged.map((question) => effectiveQuestionKey(standard, question));
        assert.equal(
          new Set(keys).size,
          keys.length,
          `${source.name} ${targetFrequency} ${standard} contains duplicate logical checks`
        );
      }
    }
  }
});

test("higher-frequency conveyor wording supersedes recurring lower-frequency checks", () => {
  const monthly = mergeCumulativeForTest(conveyorChecklist, "monthly", "NFPA 72");
  const panelRows = monthly.filter((question) => question.dedupeKey === "panel-normal");
  const heatControllerRows = monthly.filter((question) => question.dedupeKey === "linear-heat-controller-health");
  const flameVisualRows = monthly.filter((question) => question.dedupeKey === "flame-detector-visual");

  assert.equal(panelRows.length, 1);
  assert.equal(
    panelRows[0].question,
    "Fire alarm / releasing panel(s) show NORMAL; no unresolved fire, supervisory or trouble condition."
  );

  assert.equal(heatControllerRows.length, 1);
  assert.equal(
    heatControllerRows[0].question,
    "FiberSystem 8000 controller healthy; no relay, communication or fibre channel fault."
  );

  assert.equal(flameVisualRows.length, 1);
  assert.equal(
    flameVisualRows[0].question,
    "Flame detector windows clean; detectors unobstructed and aimed correctly."
  );
});


test("cumulative servicing order stays Weekly-first while later wording supersedes duplicates", () => {
  const order = ["weekly", "monthly", "quarterly", "annual"];
  const sources = [
    { name: "substation", data: checklist },
    { name: "conveyor", data: conveyorChecklist }
  ];

  for (const source of sources) {
    for (const targetFrequency of order) {
      const targetIndex = order.indexOf(targetFrequency);
      const standards = new Set();
      for (const frequency of order.slice(0, targetIndex + 1)) {
        Object.keys(source.data?.[frequency] || {}).forEach((standard) => standards.add(standard));
      }

      for (const standard of standards) {
        const firstOccurrenceKeys = [];
        const seen = new Set();

        for (const frequency of order.slice(0, targetIndex + 1)) {
          const questions = Array.isArray(source.data?.[frequency]?.[standard])
            ? source.data[frequency][standard]
            : [];

          for (const question of questions) {
            const key = effectiveQuestionKey(standard, question);
            if (seen.has(key)) continue;
            seen.add(key);
            firstOccurrenceKeys.push(key);
          }
        }

        const mergedKeys = mergeCumulativeForTest(source.data, targetFrequency, standard)
          .map((question) => effectiveQuestionKey(standard, question));

        assert.deepEqual(
          mergedKeys,
          firstOccurrenceKeys,
          `${source.name} ${targetFrequency} ${standard} must keep first-frequency ordering`
        );
      }
    }
  }
});
