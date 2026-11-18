// Local SVG charts: saved assessment data only, no model calls or chart CDN.
const NS = "http://www.w3.org/2000/svg";
const kinds = {
  strong: { label: "Strong explanation", short: "Strong", color: "#81dac5" },
  partial: { label: "Partial understanding", short: "Partial", color: "#edc580" },
  weak: { label: "Core gaps", short: "Core gaps", color: "#ef9ca9" },
  skipped: { label: "Skipped", short: "Skipped", color: "#8c9daf" },
  unverified: { label: "Unverified assessment", short: "Unverified", color: "#b5ace4" },
  assessed: { label: "Saved assessment", short: "Assessed", color: "#91c3f1" },
};
const skills = { data_flow: "Data flow", control_flow: "Control flow", state_effects: "State and side effects", language_semantics: "Language semantics" };
let nextId = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function svgEl(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function normalize(records) {
  return (Array.isArray(records) ? records : []).filter(r => r && typeof r === "object").map((r, index) => {
    const outcome = Object.hasOwn(kinds, r.outcome) ? r.outcome : "unverified";
    const score = typeof r.score === "number" && Number.isFinite(r.score) && r.score >= 0 && r.score <= 100
      && !["skipped", "unverified"].includes(outcome) ? r.score : null;
    return { ...r, outcome, score, index, question_id: String(r.question_id || `q${index + 1}`),
      difficulty: Number.isInteger(r.difficulty) && r.difficulty >= 1 && r.difficulty <= 4 ? r.difficulty : null,
      evidence: Array.isArray(r.evidence) ? r.evidence.filter(q => typeof q === "string") : [] };
  });
}

function questionLabel(record) {
  return `Q${record.index + 1}`;
}

function description(record) {
  return `${questionLabel(record)}: ${kinds[record.outcome].label}, ${record.score === null ? "no verified score" : `${record.score}/100`}`
    + (record.difficulty === null ? "" : `, difficulty L${record.difficulty}`);
}

function caption(title, subtitle, tag) {
  const header = el("div", "review-chart-heading");
  const copy = el("div", "");
  copy.append(el("h4", "", title), el("p", "", subtitle));
  header.append(copy);
  if (tag) header.append(el("span", "review-chart-tag", tag));
  return header;
}

function distribution(records) {
  const card = el("section", "review-chart-card review-distribution");
  card.setAttribute("aria-label", "Answer status distribution");
  card.append(caption("Answer mix", "Every question has its own outcome."));
  const counts = Object.entries(kinds).map(([key, value]) => ({ key, ...value,
    count: records.filter(r => r.outcome === key).length })).filter(item => item.count);
  const ring = el("div", "review-donut");
  const svg = svgEl("svg", { viewBox: "0 0 220 220", "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("circle", { cx: 110, cy: 110, r: 83, fill: "none", stroke: "#24384a", "stroke-width": 17 }));
  let start = 0;
  for (const item of counts) {
    const share = item.count / records.length * 100;
    svg.append(svgEl("circle", { cx: 110, cy: 110, r: 83, fill: "none", stroke: item.color,
      "stroke-width": 17, pathLength: 100, "stroke-dasharray": `${share} ${100 - share}`,
      "stroke-dashoffset": -start, transform: "rotate(-90 110 110)", "data-outcome": item.key }));
    start += share;
  }
  svg.append(svgEl("text", { x: 110, y: 111, "text-anchor": "middle", class: "review-donut-count" }, records.length));
  svg.append(svgEl("text", { x: 110, y: 137, "text-anchor": "middle", class: "review-donut-label" }, records.length === 1 ? "QUESTION" : "QUESTIONS"));
  ring.append(svg);
  card.append(ring);
  const legend = el("ul", "review-chart-legend");
  for (const item of counts) {
    const li = el("li", "");
    const dot = el("span", "review-chart-dot");
    dot.style.setProperty("--outcome-color", item.color);
    dot.setAttribute("aria-hidden", "true");
    li.append(dot, el("span", "", item.short), el("strong", "", item.count),
      el("span", "review-chart-percent", `${Math.round(item.count / records.length * 100)}%`));
    legend.append(li);
  }
  card.append(legend);
  return card;
}

function evidenceTable(records) {
  const details = el("details", "review-chart-data");
  details.append(el("summary", "", "View chart data as a table"));
  const scroll = el("div", "review-table-scroll");
  const table = el("table", "");
  table.append(el("caption", "", "Saved results for each question"));
  const head = el("thead", "");
  const row = el("tr", "");
  for (const name of ["Question", "Score / 100", "Difficulty", "Outcome", "Source"]) {
    const th = el("th", "", name);
    th.scope = "col";
    row.append(th);
  }
  head.append(row);
  const body = el("tbody", "");
  for (const record of records) {
    const tr = el("tr", "");
    const th = el("th", "", questionLabel(record));
    th.scope = "row";
    tr.append(th);
    for (const value of [record.score ?? "—", record.difficulty === null ? "Not recorded" : `L${record.difficulty}`,
      kinds[record.outcome].label, record.file_path || "Not recorded"]) tr.append(el("td", "", value));
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  details.append(scroll);
  return details;
}

export function renderReviewCharts(container, observations, { onEvidence } = {}) {
  const records = normalize(observations);
  if (!records.length) return; // Historical reports without question data stay readable.
  const uid = `review-chart-${++nextId}`;
  const section = el("section", "review-visualizations");
  section.setAttribute("aria-labelledby", `${uid}-title`);
  const head = el("div", "review-visualization-heading");
  const title = el("h3", "", "Your answers, at a glance");
  title.id = `${uid}-title`;
  const plotted = records.filter(r => r.score !== null).length;
  head.append(title, el("span", "", `${plotted} scored · ${records.length} questions`));
  section.append(head);
  const grid = el("div", "review-chart-grid");
  const journey = el("section", "review-chart-card review-journey");
  journey.append(caption("Question by question", "Select a question to explore its result.", "SAVED RESULTS"));
  const hasDifficulty = records.some(r => r.difficulty !== null);
  const width = Math.max(520, records.length * 52 + 64);
  const left = 44, right = width - 20, step = (right - left) / records.length;
  const x = i => left + step * (i + .5);
  const top = 32, baseline = 188, difficultyTop = 258, difficultyBottom = 342;
  const height = hasDifficulty ? 375 : 226;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: "review-journey-svg", "aria-hidden": "true", focusable: "false" });
  svg.style.minWidth = `${width}px`;
  const scroll = el("div", "review-chart-scroll");
  scroll.setAttribute("role", "group");
  scroll.setAttribute("aria-label", "Question scores and difficulty chart. Select questions using the buttons below; the chart also has a data table.");
  svg.append(svgEl("text", { x: left, y: 14, class: "review-chart-axis-title" }, "QUESTION SCORE / 100"));
  const selected = svgEl("rect", { x: left, y: 22, width: step - 8, height: height - 40, rx: 8, class: "review-chart-selection" });
  svg.append(selected);
  for (const value of [0, 25, 50, 75, 100]) {
    const y = baseline - (baseline - top) * value / 100;
    svg.append(svgEl("line", { x1: left, x2: right, y1: y, y2: y, class: "review-chart-gridline" }));
    svg.append(svgEl("text", { x: left - 10, y: y + 4, "text-anchor": "end", class: "review-chart-tick" }, value));
  }
  for (const record of records) {
    const group = svgEl("g", { "data-question-id": record.question_id });
    group.append(svgEl("title", {}, description(record)));
    const barWidth = Math.min(28, step * .5);
    const h = record.score === null ? 0 : (baseline - top) * record.score / 100;
    if (record.score !== null) {
      group.append(svgEl("rect", { x: x(record.index) - barWidth / 2, y: baseline - Math.max(2, h),
        width: barWidth, height: Math.max(2, h), rx: 4, fill: kinds[record.outcome].color,
        class: "review-score-bar", "data-score": record.score }));
    } else {
      group.append(svgEl("path", { d: `M ${x(record.index) - 5} ${baseline - 10} l 10 10 m 0 -10 l -10 10`,
        stroke: kinds[record.outcome].color, "stroke-width": 2, "stroke-linecap": "round", class: "review-missing-score" }));
    }
    group.append(svgEl("text", { x: x(record.index), y: baseline - h - 10, "text-anchor": "middle",
      class: "review-chart-value" }, record.score ?? "—"));
    group.append(svgEl("text", { x: x(record.index), y: baseline + 21, "text-anchor": "middle",
      class: "review-chart-tick" }, questionLabel(record)));
    svg.append(group);
  }
  if (hasDifficulty) {
    svg.append(svgEl("text", { x: left, y: 240, class: "review-chart-axis-title" }, "SNIPPET DIFFICULTY"));
    const dy = level => difficultyBottom - (level - 1) * (difficultyBottom - difficultyTop) / 3;
    for (let level = 1; level <= 4; level++) {
      svg.append(svgEl("line", { x1: left, x2: right, y1: dy(level), y2: dy(level), class: "review-chart-gridline" }));
      svg.append(svgEl("text", { x: left - 10, y: dy(level) + 4, "text-anchor": "end", class: "review-chart-tick" }, `L${level}`));
    }
    let path = "", previous = null;
    for (const record of records) {
      if (record.difficulty === null) { previous = null; continue; }
      path += previous === null ? ` M ${x(record.index)} ${dy(record.difficulty)}`
        : ` H ${x(record.index)} V ${dy(record.difficulty)}`;
      previous = record;
    }
    svg.append(svgEl("path", { d: path, fill: "none", stroke: "#91c3f1", "stroke-width": 2.5,
      "stroke-linejoin": "round", class: "review-difficulty-path" }));
    for (const record of records) if (record.difficulty !== null) {
      svg.append(svgEl("circle", { cx: x(record.index), cy: dy(record.difficulty), r: 4.5,
        fill: kinds[record.outcome].color, stroke: "#102132", "stroke-width": 2 }));
      svg.append(svgEl("text", { x: x(record.index), y: difficultyBottom + 22, "text-anchor": "middle",
        class: "review-chart-tick" }, questionLabel(record)));
    }
  }
  scroll.append(svg);
  journey.append(scroll);
  journey.append(el("p", "review-chart-scroll-hint", "Swipe across the chart, or select a question below."));
  const buttons = el("div", "review-question-picker");
  buttons.setAttribute("role", "group");
  buttons.setAttribute("aria-label", "Select a question to inspect");
  const detail = el("div", "review-selected-question");
  detail.id = `${uid}-detail`;
  detail.setAttribute("aria-live", "polite");
  detail.setAttribute("aria-atomic", "true");
  const controls = [];
  function select(index, reveal = false) {
    const record = records[index];
    section.dataset.selectedQuestion = record.question_id;
    selected.setAttribute("x", x(index) - step / 2 + 4);
    controls.forEach((button, i) => {
      button.setAttribute("aria-pressed", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
    if (reveal && scroll.scrollWidth > scroll.clientWidth) {
      const scale = svg.getBoundingClientRect().width / width;
      scroll.scrollLeft = Math.max(0, x(index) * scale - scroll.clientWidth / 2);
    }
    detail.replaceChildren();
    const heading = el("div", "review-selected-heading");
    heading.append(el("span", "review-chart-tag", `SELECTED · ${questionLabel(record)}`));
    const status = el("span", "review-selected-status", kinds[record.outcome].label);
    status.style.setProperty("--outcome-color", kinds[record.outcome].color);
    heading.append(status);
    detail.append(heading);
    const location = record.file_path ? `${record.file_path}${Number.isInteger(record.start_line) && Number.isInteger(record.end_line) ? `:${record.start_line}–${record.end_line}` : ""}` : "Source location not recorded";
    detail.append(el("p", "review-selected-source", location));
    const metrics = el("dl", "review-selected-metrics");
    const values = [["Question score", record.score === null ? "—" : `${record.score}/100`]];
    if (hasDifficulty) values.push(["Difficulty", record.difficulty === null ? "Not recorded" : `L${record.difficulty}`]);
    if (skills[record.skill]) values.push(["Skill", skills[record.skill]]);
    for (const [label, value] of values) {
      const metric = el("div", "");
      metric.append(el("dt", "", label), el("dd", "", value));
      metrics.append(metric);
    }
    detail.append(metrics);
    const note = ["skipped", "unverified"].includes(record.outcome)
      ? "No verified score is plotted for this question. The dash is not a zero score."
      : record.after_related_feedback === true ? "Answered after feedback on a related skill."
      : record.after_related_feedback === false ? "First observation of this skill in the session." : "A saved individual assessment.";
    detail.append(el("p", "review-chart-note", note));
    if (record.evidence.length) detail.append(el("blockquote", "review-selected-quote", record.evidence[0]));
    if (onEvidence) {
      const evidence = el("button", "review-evidence-link", "View answer evidence →");
      evidence.type = "button";
      evidence.addEventListener("click", () => onEvidence(record.question_id));
      detail.append(evidence);
    }
  }
  for (const record of records) {
    const button = el("button", "review-question-button", questionLabel(record));
    button.type = "button";
    button.dataset.outcome = record.outcome;
    button.style.setProperty("--outcome-color", kinds[record.outcome].color);
    button.setAttribute("aria-label", description(record));
    button.setAttribute("aria-controls", detail.id);
    button.addEventListener("click", () => select(record.index, true));
    button.addEventListener("keydown", event => {
      const next = event.key === "ArrowRight" ? (record.index + 1) % records.length
        : event.key === "ArrowLeft" ? (record.index - 1 + records.length) % records.length
        : event.key === "Home" ? 0 : event.key === "End" ? records.length - 1 : null;
      if (next !== null) { event.preventDefault(); select(next, true); controls[next].focus({ preventScroll: true }); }
    });
    controls.push(button);
    buttons.append(button);
    const hit = svgEl("rect", { x: x(record.index) - step / 2, y: 22, width: step,
      height: height - 34, fill: "transparent", class: "review-chart-hit", "data-question-id": record.question_id });
    hit.append(svgEl("title", {}, description(record)));
    hit.addEventListener("click", () => select(record.index));
    svg.append(hit);
  }
  journey.append(buttons, el("p", "review-chart-note", "Question scores describe each answer, not overall ability. Compare them alongside difficulty. — means skipped or unverified."));
  grid.append(journey, distribution(records));
  section.append(grid, detail, evidenceTable(records));
  container.append(section);
  select(0);
}

export function renderSkillCoverage(container, profileSkills, observations) {
  const records = normalize(observations);
  const rows = (Array.isArray(profileSkills) ? profileSkills : []).map(skill => ({ ...skill,
    answers: records.filter(r => r.skill === skill.key && !["skipped", "unverified"].includes(r.outcome)) }));
  const maximum = Math.max(1, ...rows.map(row => row.answers.length));
  container.append(caption("Skill coverage", "See where your answers provide evidence.", "ANSWER COUNTS"));
  for (const row of rows) {
    const group = el("div", "review-skill-row");
    const label = el("div", "review-skill-heading");
    label.append(el("strong", "", row.label), el("span", "", row.answers.length
      ? `${row.answers.length} assessed · ${row.source_files} files` : "Not assessed"));
    group.append(label);
    const track = el("div", "review-skill-track");
    track.setAttribute("aria-hidden", "true");
    const descriptions = [];
    for (const [key, kind] of Object.entries(kinds)) {
      const count = row.answers.filter(r => r.outcome === key).length;
      if (!count) continue;
      const segment = el("span", "review-skill-segment");
      segment.style.width = `${count / maximum * 100}%`;
      segment.style.background = kind.color;
      segment.dataset.outcome = key;
      segment.title = `${count} ${kind.short.toLowerCase()} answers`;
      track.append(segment);
      descriptions.push(`${count} ${kind.short.toLowerCase()}`);
    }
    group.append(track, el("p", "review-chart-note", descriptions.length ? descriptions.join(" · ") : "No assessed answers for this skill yet."));
    container.append(group);
  }
  container.append(el("p", "review-chart-note", "Bar length shows the number of answers, not a mastery percentage. Unassessed skills remain open."));
}
