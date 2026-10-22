// Tests heron search (run after dev/open-inbox.js and dev/wait-index.js).
// Each case types a query into the top field and compares the messages shown with the expected count.
const wait = ms => new Promise(r => setTimeout(r, ms));
const a = () => window.gTabmail.currentAbout3Pane;
const input = document.querySelector("global-search-bar").shadowRoot.querySelector("input");
const type = text => {
  input.focus();
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" }));
};
const shown = () => {
  const v = a().gDBView;
  const out = [];
  for (let i = 0; i < v.rowCount; i++) {
    out.push(v.getMsgHdrAt(i).mime2DecodedSubject.slice(0, 28));
  }
  return out.sort();
};
const tabs = () => window.gTabmail.tabInfo.length;

// Flat view: one message per row, easier to check.
a().gViewWrapper.showUnthreaded = true;
await wait(800);

const cases = [
  ["de:olivier", 3], // 2 messages from the thread + the estimate
  ["de:léa", 1],
  ["objet:forum", 1],
  ["pj", 1],
  ["drapeau", 1],
  ["non-lu", null], // count reported only
  ["depuis:2026-10-17 avant:2026-10-19", 3], // Club de lecture, Revue Science, Le Quotidien (Oct 17)
  ["de:olivier pj", 1],
  ["rapport de:olivier", null],
  ["étiquette:important", 1], // the estimate carries Thunderbird's "Important" tag
  ["tag:$label1", 1],
  ["etiquette:impor non-lu", 1],
  ["étiquette:inexistante", 0],
];
const results = {};
for (const [query, expected] of cases) {
  type(query);
  await wait(1800);
  const list = shown();
  results[query] = { n: list.length, expected, ok: expected == null ? "n/a" : list.length == expected, list };
}

// "All folders" counter (Gloda index), with and without accents.
const allCount = () => {
  const text = a().document.getElementById("heron-scope")?.lastChild?.textContent ?? "";
  return Number(/· (\d+)/.exec(text)?.[1] ?? -1);
};
for (const [query, expected] of [["de:léa", 1], ["de:lea", 1], ["pj", 1], ["dossier:envoy", 1], ["étiquette:important", 1]]) {
  type(query);
  await wait(3000);
  const n = allCount();
  results[`all folders: ${query}`] = { n, expected, ok: n == expected };
  if (a().gViewWrapper?.isSynthetic) {
    type("");
    await wait(1500);
  }
}

// Panel: the filters button in the field, then "From" filled in, so the field writes itself.
type("");
await wait(800);
const filterButton = document.querySelector("global-search-bar").shadowRoot.querySelector("#heron-filters");
filterButton.click();
await wait(300);
const panel = document.getElementById("heron-search-panel");
const from = panel.querySelector("[name=from]");
from.value = "Bergeron";
from.dispatchEvent(new InputEvent("input", { bubbles: true }));
const attach = panel.querySelector("[name=attachment]");
attach.click();
await wait(1800);
results.panel = { visible: !panel.hidden, field: input.value, n: shown().length, button: filterButton.getAttribute("aria-pressed") };

// All folders: a specific folder, from the panel.
const folder = panel.querySelector("[name=folder]");
from.value = "";
from.dispatchEvent(new InputEvent("input", { bubbles: true }));
attach.click();
folder.value = "envoy";
folder.dispatchEvent(new InputEvent("input", { bubbles: true }));
await wait(2500);
results.folder = { field: input.value, synthetic: !!a().gViewWrapper?.isSynthetic, list: shown(), tabs: tabs() };

// Clear from the panel: back to the normal list.
[...panel.querySelectorAll("button")].find(b => ["Clear", "Effacer"].includes(b.textContent)).click();
await wait(2000);
results.cleared = { field: input.value, synthetic: !!a().gViewWrapper?.isSynthetic, n: a().gDBView.rowCount, bar: !!a().document.getElementById("heron-scope") };
return results;
