const DEFAULT_CONFIG = {
  enabled: true, // swiping
  left: "delete", // action when the card is swiped left
  right: "archive", // action when the card is swiped right
  undoSeconds: 6,
  invert: false, // reverses the gesture direction (depending on the system scroll setting)
  conversationOrder: "oldest-first", // or "newest-first"
  chatLayout: true, // conversation view as chat bubbles (yours on the right)
  fontScale: 1.15, // text size: multiple of the system size (1 = same)
  darkMessages: true, // dark message content when the system is dark
  preview: true, // text preview in the list (3rd line of the cards)
  undoSendSeconds: 10, // delay to undo a send (0 = send immediately)
  // Modules: each can be turned off (applied right away, without restarting).
  modules: {
    theme: true,
    list: true,
    threads: true,
    unifiedFolders: true,
    conversation: true,
    swipe: true,
    search: true,
    glance: true,
    compose: true,
    foldQuotes: true,
    trackers: true,
    undoSend: true,
  },
  // Thunderbird settings the user keeps if heron is turned off or removed.
  keep: {
    density: false,
    fontSize: false,
    unifiedFolders: false,
  },
};

async function loadConfig() {
  const { config } = await browser.storage.local.get("config");
  return {
    ...DEFAULT_CONFIG,
    ...config,
    modules: { ...DEFAULT_CONFIG.modules, ...config?.modules },
    keep: { ...DEFAULT_CONFIG.keep, ...config?.keep },
  };
}

/** All strings from _locales/<language>/messages.json, in Thunderbird's language. */
async function loadStrings() {
  const response = await fetch(browser.runtime.getURL("_locales/fr/messages.json"));
  const keys = Object.keys(await response.json());
  return Object.fromEntries(keys.map(key => [key, browser.i18n.getMessage(key)]));
}

(async () => {
  const [config, strings] = await Promise.all([loadConfig(), loadStrings()]);
  await browser.heron.init(config, strings);
})();

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area == "local" && changes.config) {
    browser.heron.setConfig(await loadConfig());
  }
});

// Folds the reply history in each displayed message (tabs, windows, reading pane), only if the "foldQuotes" module is on.
let foldScript = null;
async function updateFoldScript() {
  const on = (await loadConfig()).modules.foldQuotes !== false;
  if (on && !foldScript) {
    foldScript = await browser.messageDisplayScripts.register({ js: [{ file: "content/fold-quotes.js" }] });
  } else if (!on && foldScript) {
    await foldScript.unregister();
    foldScript = null;
  }
}
updateFoldScript();
browser.storage.onChanged.addListener((changes, area) => {
  if (area == "local" && changes.config) {
    updateFoldScript();
  }
});
