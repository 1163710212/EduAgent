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
    const detail = Array.isArray(data.detail)
      ? data.detail.map((entry) => entry.msg).join("; ") : data.detail;
    throw new Error(detail || `Request failed (${response.status})`);
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

export function continueChallenge(sessionId, questionId) {
  return request(`/api/challenges/${encodeURIComponent(sessionId)}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId }),
  });
}

export function evaluateNext(sessionId) {
  return request(`/api/challenges/${encodeURIComponent(sessionId)}/review/evaluate`, { method: "POST" });
}

export function adaptiveAction(sessionId, questionId, action) {
  if (!["skip", "finish"].includes(action)) throw new Error("Unknown practice action.");
  return request(`/api/challenges/${encodeURIComponent(sessionId)}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId }),
  });
}
