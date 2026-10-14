function normalizeYesNoChoice(value) {
  if (value === true) return "yes";
  if (value === false) return "no";

  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return "yes";
  if (["no", "n", "false", "0"].includes(normalized)) return "no";
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

  // Backward compatibility for older servicing drafts created before
  // checklist feature metadata was introduced.
  if (wanted === "ASD") {
    return /\bASD\b/i.test(String(record?.question || ""));
  }

  return false;
}

function filterServicingResponses(responses, options = {}) {
  const list = Array.isArray(responses) ? responses : [];
  const asdInstalled = normalizeYesNoChoice(options?.asdInstalled);

  // Older drafts have no feature selection; preserve their historical content.
  if (asdInstalled !== "no") return list;

  return list.filter((response) => !requiresFeature(response, "ASD"));
}

module.exports = {
  normalizeYesNoChoice,
  featureRequirements,
  requiresFeature,
  filterServicingResponses
};
