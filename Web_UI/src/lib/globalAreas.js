async function readJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const error = new Error(data?.message || `Request failed (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function authHeaders(authToken, extra = {}) {
  return {
    ...extra,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
  };
}

export async function fetchGlobalAreas(authToken) {
  try {
    const res = await fetch("/api/areas", {
      headers: authHeaders(authToken)
    });
    const data = await readJsonResponse(res);
    return Array.isArray(data?.areas) ? data.areas : [];
  } catch (e) {
    // Temporary deployment compatibility while the new shared areas route is
    // being rolled out to the API server.
    if (Number(e?.status || 0) !== 404) throw e;

    const fallback = await fetch("/api/servicing/areas", {
      headers: authHeaders(authToken)
    });
    const data = await readJsonResponse(fallback);
    return Array.isArray(data?.areas) ? data.areas : [];
  }
}

export async function addGlobalArea(authToken, areaName) {
  const area = String(areaName || "").replace(/\s+/g, " ").trim();
  if (!area) throw new Error("Area name is required.");

  const res = await fetch("/api/areas", {
    method: "POST",
    headers: authHeaders(authToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ area })
  });

  const data = await readJsonResponse(res);
  return {
    area: String(data?.area || area),
    areas: Array.isArray(data?.areas) ? data.areas : [],
    created: data?.created !== false
  };
}

export function hasExactAreaMatch(areas, value) {
  const wanted = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!wanted) return false;
  return (areas || []).some(
    (area) => String(area || "").replace(/\s+/g, " ").trim().toLowerCase() === wanted
  );
}
