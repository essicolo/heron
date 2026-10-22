const t = (key, ...args) =>
  args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), browser.i18n.getMessage(key) || key);

const ACTIONS = ["delete", "archive", "toggleRead", "flag", "junk", "none"];
const ACTION_LABELS = {
  delete: "actionDelete",
  archive: "actionArchive",
  toggleRead: "actionToggleRead",
  flag: "actionFlag",
  junk: "actionJunk",
  none: "actionNone",
};
const DEFAULTS = {
  enabled: true,
  left: "delete",
  right: "archive",
  undoSeconds: 6,
  invert: false,
  conversationOrder: "oldest-first",
  chatLayout: true,
  fontScale: 1.15,
  darkMessages: true,
  preview: true,
  undoSendSeconds: 10,
  modules: {},
  keep: {},
};

/**
 * Settings that can be kept when removing heron, and what each depends on (a heron module or setting): without it, heron changes nothing, so there is nothing to keep.
 */
const KEEP = {
  density: c => c.modules?.theme !== false,
  fontSize: c => Number(c.fontScale) != 1,
  unifiedFolders: c => c.modules?.unifiedFolders !== false,
};

/** Modules, in display order. */
const MODULES = ["theme", "conversation", "threads", "list", "swipe", "search", "glance", "foldQuotes", "trackers", "undoSend", "compose", "unifiedFolders"];
const $ = id => document.getElementById(id);

// Translated strings (Thunderbird's language).
document.documentElement.lang = browser.i18n.getUILanguage();
for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n);
}
for (const option of $("undoSeconds").options) {
  option.textContent = t("optionsSeconds", option.value);
}
for (const option of $("undoSendSeconds").options) {
  if (option.value != "0") {
    option.textContent = t("optionsSeconds", option.value);
  }
}
for (const module of MODULES) {
  const label = document.createElement("label");
  label.className = "row";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset.module = module;
  const text = document.createElement("span");
  text.textContent = t(`module_${module}`);
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = t(`module_${module}_hint`);
  label.append(box, text, hint);
  $("modules").append(label);
}

for (const name of Object.keys(KEEP)) {
  const label = document.createElement("label");
  label.className = "row";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset.keep = name;
  const text = document.createElement("span");
  text.textContent = t(`keep_${name}`);
  label.append(box, text);
  $("keep").append(label);
}

/** "Keep" only makes sense if heron changes this setting. */
function updateKeep(c = current()) {
  for (const box of document.querySelectorAll("[data-keep]")) {
    box.disabled = !KEEP[box.dataset.keep](c);
    box.closest("label").classList.toggle("disabled", box.disabled);
  }
}

/** Modules turned off automatically (incompatible with this Thunderbird version). */
async function showFailures() {
  const status = await browser.heron.getStatus();
  $("failures").hidden = !status.failed.length;
  $("failuresList").replaceChildren(
    ...status.failed.map(({ module, error }) => {
      const li = document.createElement("li");
      li.textContent = `${t(`module_${module}`)}${t("labelSeparator")}${error}`;
      return li;
    })
  );
}
$("retry").addEventListener("click", async () => {
  await browser.heron.clearFailures();
  $("failuresList").replaceChildren();
  $("saved").textContent = t("optionsRetryDone");
});
for (const option of $("fontScale").options) {
  if (option.value != "1") {
    option.textContent = `× ${Number(option.value).toLocaleString(document.documentElement.lang)}`;
  }
}
for (const id of ["left", "right"]) {
  for (const action of ACTIONS) {
    $(id).add(new Option(t(ACTION_LABELS[action]), action));
  }
}

async function load() {
  const { config } = await browser.storage.local.get("config");
  const c = { ...DEFAULTS, ...config };
  $("enabled").checked = c.enabled;
  $("left").value = c.left;
  $("right").value = c.right;
  $("undoSeconds").value = String(c.undoSeconds);
  $("invert").checked = c.invert;
  $("conversationOrder").value = c.conversationOrder;
  $("chatLayout").checked = c.chatLayout;
  $("fontScale").value = String(c.fontScale);
  $("darkMessages").checked = c.darkMessages;
  $("preview").checked = c.preview;
  $("undoSendSeconds").value = String(c.undoSendSeconds);
  for (const box of document.querySelectorAll("[data-module]")) {
    box.checked = c.modules?.[box.dataset.module] !== false;
  }
  for (const box of document.querySelectorAll("[data-keep]")) {
    box.checked = c.keep?.[box.dataset.keep] === true;
  }
  updateKeep(c);
}

/** Settings as shown on the page. */
function current() {
  return {
    enabled: $("enabled").checked,
    left: $("left").value,
    right: $("right").value,
    undoSeconds: Number($("undoSeconds").value),
    invert: $("invert").checked,
    conversationOrder: $("conversationOrder").value,
    chatLayout: $("chatLayout").checked,
    fontScale: Number($("fontScale").value),
    darkMessages: $("darkMessages").checked,
    preview: $("preview").checked,
    undoSendSeconds: Number($("undoSendSeconds").value),
    modules: Object.fromEntries(
      [...document.querySelectorAll("[data-module]")].map(box => [box.dataset.module, box.checked])
    ),
    keep: Object.fromEntries([...document.querySelectorAll("[data-keep]")].map(box => [box.dataset.keep, box.checked])),
  };
}

let timer;
async function save() {
  const config = current();
  updateKeep(config);
  await browser.storage.local.set({ config });
  $("saved").textContent = t("optionsSaved");
  clearTimeout(timer);
  timer = setTimeout(() => ($("saved").textContent = ""), 1500);
}

for (const el of document.querySelectorAll("input, select")) {
  el.addEventListener("change", save);
}
load();
showFailures();
