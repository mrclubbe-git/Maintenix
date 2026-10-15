function normalizeYesNoChoice(value) {
  if (value === true) return "yes";
  if (value === false) return "no";

  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return "yes";
  if (["no", "n", "false", "0"].includes(normalized)) return "no";
  return "";
}

function normalizeLinearHeatType(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (["fiber", "fibre", "fiber_linear_heat", "fibre_linear_heat"].includes(normalized)) return "fiber";
  if (["standard", "standard_linear_heat"].includes(normalized)) return "standard";
  return "";
}

function featureRequirements(record) {
  const out = [];

  const single = String(record?.requiresFeature || record?.requires || "").trim().toUpperCase();
  if (single) out.push(single);

  const multiple = Array.isArray(record?.requiresFeatures)
    ? record.requiresFeatures
    : [];
  multiple.forEach((value) => {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized) out.push(normalized);
  });

  return [...new Set(out)];
}

function requiresFeature(record, feature) {
  const wanted = String(feature || "").trim().toUpperCase();
  if (!wanted) return false;

  const requirements = featureRequirements(record);
  if (requirements.includes(wanted)) return true;

  const question = String(record?.question || "");

  // Backward compatibility for older servicing drafts created before
  // checklist feature metadata was introduced.
  if (wanted === "ASD") {
    return /\bASD\b/i.test(question);
  }

  if (wanted === "FIBER_LINEAR_HEAT") {
    return /FiberSystem|\bfibre optic\b|\bfibre controller\b|\bfibre system\b/i.test(question);
  }

  if (wanted === "STANDARD_LINEAR_HEAT") {
    return /\bstandard linear heat\b|\blinear heat interface unit\b|\bend-of-line unit\b/i.test(question);
  }

  return false;
}

function filterServicingResponses(responses, options = {}) {
  let list = Array.isArray(responses) ? responses : [];
  const asdInstalled = normalizeYesNoChoice(options?.asdInstalled);

  if (asdInstalled === "no") {
    list = list.filter((response) => !requiresFeature(response, "ASD"));
  }

  const linearHeatType = normalizeLinearHeatType(options?.linearHeatType);

  // Older conveyor drafts have no linearHeatType; preserve their historical
  // fibre-based content. New payloads explicitly select one variant.
  if (linearHeatType === "fiber") {
    list = list.filter((response) => !requiresFeature(response, "STANDARD_LINEAR_HEAT"));
  } else if (linearHeatType === "standard") {
    list = list.filter((response) => !requiresFeature(response, "FIBER_LINEAR_HEAT"));
  }

  return list;
}

module.exports = {
  normalizeYesNoChoice,
  normalizeLinearHeatType,
  featureRequirements,
  requiresFeature,
  filterServicingResponses
};
