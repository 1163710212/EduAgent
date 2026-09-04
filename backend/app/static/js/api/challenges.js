async function parseResponse(response) {
  const raw = await response.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (_) {
    return { detail: raw };
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }
  return data;
}

export function createChallenge(payload) {
  return request("/api/challenges/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getChallenge(sessionId) {
  return request(`/api/challenges/${encodeURIComponent(sessionId)}`);
}

export function submitChallenge(sessionId, payload) {
  return request(`/api/challenges/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getReview(sessionId) {
  return request(`/api/challenges/${encodeURIComponent(sessionId)}/review`);
}
