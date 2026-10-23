/* global ExtensionCommon, ChromeUtils, Components, Services */
/* eslint-disable no-undef */

var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { UIFontSize } = ChromeUtils.importESModule("resource:///modules/UIFontSize.sys.mjs");

/**
 * heron: privileged API. Runs the content/ modules in Thunderbird's windows, registers their style sheets and applies their settings.
 *
 * Main window (messenger.xhtml):
 * - search.js (single and advanced search), glance.js (cards instead of tabs), window.js (unified folders), undo-send.js (undo send).
 * Each mail tab (about:3pane):
 * - theme-pane.js (appearance), swipe.js (swiping), list.js (dates, sender, preview), threads.js (one row per conversation), conversation.js (conversation view).
 * Each displayed message (about:message):
 * - fold-quotes.js (quoted text), trackers.js (trackers), recipients.js (collapsible recipient list, once per reader).
 * Compose window: compose.js.
 *
 * Robustness:
 * - each module can be turned off in the options;
 * - a module that fails at startup is turned off for this Thunderbird version (degraded mode): Thunderbird then keeps its normal behavior, and the options report it;
 * - the Thunderbird settings changed by heron are saved and restored to their original value when the module or the extension is turned off.
 *
 * Modules read the globals `heronConfig` (settings) and `heronStrings` (translated strings), and rely on content/prelude.js so they can be stopped without restarting Thunderbird.
 */

/** Thunderbird settings applied by each module. */
const MODULE_PREFS = {
  theme: {
    "mail.uidensity": 2,
    "mail.fixed_width_messages": false,
    "mail.dark-reader.show-toggle": false,
  },
  list: {
    "mail.addressDisplayFormat": 2, // name only: list.js adds the real domain
  },
  conversation: {
    "mail.thread.conversation.enabled": true, // the native view, in case heron is turned off later
  },
};

/** Module scripts (loaded from the extension, see BASE), by name. */
const MODULE_FILES = {
  foldQuotes: "content/fold-quotes.js",
  swipe: "content/swipe.js",
  search: "content/search.js",
  glance: "content/glance.js",
  list: "content/list.js",
  compose: "content/compose.js",
  conversation: "content/conversation.js",
  threads: "content/threads.js",
  themePane: "content/theme-pane.js",
  revert: "content/revert.js",
  window: "content/window.js",
  trackers: "content/trackers.js",
  recipients: "content/recipients.js",
  undoSend: "content/undo-send.js",
  undoSendCompose: "content/undo-send-compose.js",
};

/** Style sheets by module. */
const STYLE_FILES = {
  theme: "styles/theme.css",
  search: "styles/search.css",
  glance: "styles/glance.css",
  compose: "styles/compose.css",
};

/** Root of the extension's files, registered by init(). */
const BASE = "chrome://heron/content/";

const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);

/**
 * Settings the user can keep when removing heron (options "If I remove heron...").
 * The others are always restored: in particular showing the sender's name only, which without the domain added by heron would hide impersonations.
 */
const KEEPABLE_PREFS = {
  density: "mail.uidensity",
  fontSize: "mail.uifontsize",
};

const SAVED_PREFS = "extensions.heron.savedPrefs";
const FAILED = "extensions.heron.failedModules";
// Name of the extension before "heron": if it (or its traces) is still there, its original values are taken over, otherwise heron would mistake the settings it changed for the user's.
const LEGACY_SAVED_PREFS = "extensions.zenbird.savedPrefs";

const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

// --- Thunderbird settings: written, saved, restored ----------------------------------------

function readPref(name) {
  switch (Services.prefs.getPrefType(name)) {
    case Services.prefs.PREF_BOOL:
      return Services.prefs.getBoolPref(name);
    case Services.prefs.PREF_INT:
      return Services.prefs.getIntPref(name);
    case Services.prefs.PREF_STRING:
      return Services.prefs.getStringPref(name);
  }
  return undefined;
}

function writePref(name, value) {
  if (readPref(name) === value) {
    return;
  }
  if (typeof value == "boolean") {
    Services.prefs.setBoolPref(name, value);
  } else if (Number.isInteger(value)) {
    Services.prefs.setIntPref(name, value);
  } else {
    Services.prefs.setStringPref(name, String(value));
  }
}

function restorePref(name, saved) {
  if (saved.userValue === undefined) {
    Services.prefs.clearUserPref(name);
  } else {
    writePref(name, saved.userValue);
  }
}

/** Applies `desired`; saves each setting's original value the first time. */
function applyPrefs(desired) {
  if (!Services.prefs.prefHasUserValue(SAVED_PREFS) && Services.prefs.prefHasUserValue(LEGACY_SAVED_PREFS)) {
    Services.prefs.setStringPref(SAVED_PREFS, Services.prefs.getStringPref(LEGACY_SAVED_PREFS));
    Services.prefs.clearUserPref(LEGACY_SAVED_PREFS);
  }
  const saved = JSON.parse(Services.prefs.getStringPref(SAVED_PREFS, "{}"));
  for (const name of Object.keys(saved)) {
    if (!(name in desired)) {
      restorePref(name, saved[name]);
      delete saved[name];
    }
  }
  for (const [name, value] of Object.entries(desired)) {
    if (!(name in saved)) {
      saved[name] = Services.prefs.prefHasUserValue(name) ? { userValue: readPref(name) } : {};
    }
    writePref(name, value);
  }
  Services.prefs.setStringPref(SAVED_PREFS, JSON.stringify(saved));
}

/** Restores each setting to its original value, except those in `keep` (left as they are). */
function restoreAllPrefs(keep = []) {
  const saved = JSON.parse(Services.prefs.getStringPref(SAVED_PREFS, "{}"));
  for (const [name, value] of Object.entries(saved)) {
    if (!keep.includes(name)) {
      restorePref(name, value);
    }
  }
  Services.prefs.clearUserPref(SAVED_PREFS);
}

// --- Failed modules (degraded mode) -----------------------------------------------------------

const appVersion = () => Services.appinfo.version;
const failures = () => JSON.parse(Services.prefs.getStringPref(FAILED, "{}"));
function recordFailure(module, error) {
  const all = failures();
  all[module] = { version: appVersion(), error: String(error?.message ?? error).slice(0, 200) };
  Services.prefs.setStringPref(FAILED, JSON.stringify(all));
}
const hasFailed = module => failures()[module]?.version == appVersion();

var heron = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) {
      // Disable, uninstall or update: give Thunderbird back as we found it, without waiting for a restart (windows, settings, styles).
      // Settings first: the message displayed at shutdown will use the user's own.
      restoreAllPrefs(this.keptPrefs?.() ?? []);
      this.stop?.();
    }
  }

  getAPI(context) {
    const self = this;
    let strings = {};
    let config = {};
    /** Registered style sheets, by module: nsIURI. */
    const sheets = new Map();

    let chromeHandle = null;

    const moduleOn = name => config.modules?.[name] !== false && !hasFailed(name);

    // --- Running modules -----------------------------------------------------------------------

    /**
     * Running modules, in order: { module, name, window, sandbox, follow }. Stopped in reverse order. Those of displayed messages (follow: false) do not receive settings, and a reader keeps only the last one of each kind: the list stays short, even after thousands of messages read.
     */
    let running = [];

    const alive = window => {
      try {
        return !Components.utils.isDeadWrapper(window) && !window.closed;
      } catch {
        return false;
      }
    };

    /**
     * Runs the module `name` (file MODULE_FILES[name]) in a sandbox whose prototype is `window`. On failure, the module is stopped and turned off for this Thunderbird version.
     * `follow`: the script receives updated settings (otherwise: weak reference, see `running`).
     */
    function runModule(window, name, { follow = true, module = name, force = false, xrays = false } = {}) {
      if (!force && !moduleOn(module)) {
        return null;
      }
      let sandbox;
      try {
        sandbox = Components.utils.Sandbox(window, {
          sandboxPrototype: window,
          // Xrays for untrusted content (a message's own document): the privileged code then sees the DOM as the browser defines it, whatever the message contains.
          wantXrays: xrays,
        });
        sandbox.heronConfig = Components.utils.cloneInto(config, sandbox);
        sandbox.heronStrings = Components.utils.cloneInto(strings, sandbox);
        Services.scriptloader.loadSubScript(`${BASE}content/prelude.js`, sandbox);
        Services.scriptloader.loadSubScript(`${BASE}${MODULE_FILES[name]}`, sandbox);
        if (!follow) {
          running = running.filter(e => e.follow || e.name != name || e.window != window);
        }
        running.push({ module, name, window, sandbox, follow });
        return sandbox;
      } catch (e) {
        console.error(`heron: module ${module} turned off (failed)`, e);
        recordFailure(module, e);
        try {
          sandbox?.heronStop?.(); // what it had already set up
        } catch {}
        return null;
      }
    }

    /** Stops all modules (reverse start order). */
    function stopModules() {
      for (const entry of running.reverse()) {
        if (!alive(entry.window)) {
          continue;
        }
        try {
          entry.sandbox.heronStop();
        } catch (e) {
          // Message already replaced: its document is gone, there is nothing left to undo.
          if (entry.follow) {
            console.error(`heron: stopping module ${entry.module}`, e);
          }
        }
      }
      running = [];
      for (const { target, fn } of msgListeners) {
        try {
          target.removeEventListener("MsgLoaded", fn, true);
        } catch {}
      }
      msgListeners.clear();
      hooked = new WeakSet();
    }

    /** Forgets the modules of closed windows and gone messages. */
    function forgetDead() {
      running = running.filter(entry => alive(entry.window));
      for (const entry of msgListeners) {
        if (!alive(entry.target.ownerGlobal ?? entry.target.defaultView ?? entry.target)) {
          msgListeners.delete(entry);
        }
      }
    }

    // --- Style sheets by module ----------------------------------------------------------------

    /** Each module's sheets (each limited to Thunderbird's pages by @-moz-document). */
    function updateSheets() {
      for (const [module, file] of Object.entries(STYLE_FILES)) {
        const on = moduleOn(module);
        const registered = sheets.get(module);
        if (on && !registered) {
          const uri = Services.io.newURI(`${BASE}${file}`);
          sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
          sheets.set(module, uri);
        } else if (!on && registered) {
          sss.unregisterSheet(registered, sss.USER_SHEET);
          sheets.delete(module);
        }
      }
    }

    function removeSheets() {
      for (const uri of sheets.values()) {
        if (sss.sheetRegistered(uri, sss.USER_SHEET)) {
          sss.unregisterSheet(uri, sss.USER_SHEET);
        }
      }
      sheets.clear();
    }

    // --- Thunderbird settings ------------------------------------------------------------------

    function updatePrefs() {
      const desired = {};
      for (const [module, prefs] of Object.entries(MODULE_PREFS)) {
        if (moduleOn(module)) {
          Object.assign(desired, prefs);
        }
      }
      // List: 3 lines per card with the text preview, 2 without.
      if (moduleOn("list")) {
        desired["mail.threadpane.cardsview.rowcount"] = config.preview !== false ? 3 : 2;
      }
      // Text size: a multiple of the system size (known once a window is open).
      const scale = Number(config.fontScale) || 1;
      if (UIFontSize.osValue) {
        desired["mail.uifontsize"] = scale == 1 ? 0 : Math.round(UIFontSize.osValue * scale);
      }
      // Dark messages when the system is dark (global setting, not per message).
      desired["mail.dark-reader.enabled"] = config.darkMessages !== false;
      applyPrefs(desired);
    }

    // --- Displayed messages (about:message) -------------------------------------------------------

    /** Applies the message modules to the message displayed in `browser` (about:message reader). */
    function onMessageShown(browser) {
      forgetDead();
      try {
        // Collapsible recipients: once per reader (it keeps its rows from one message to the next).
        const reader = browser.contentWindow;
        if (reader && !reader.__heronRecipients) {
          runModule(reader, "recipients", { follow: false, module: "theme" });
        }
        const doc = browser.contentDocument?.querySelector?.("#messagepane")?.contentDocument;
        if (!doc?.body || doc.documentElement.dataset.heronFolded) {
          return;
        }
        // The reading pane and tabs also have the message display script (background.js); the conversation view's readers do not.
        runModule(doc.defaultView, "foldQuotes", { follow: false, xrays: true });
        // Trackers: in the reader (it sees the message header and content).
        runModule(browser.contentWindow, "trackers", { follow: false });
      } catch (e) {
        console.error("heron: message", e);
      }
    }

    const onMsgLoaded = event => {
      const browser = event.composedPath()[0];
      if (browser?.localName == "browser") {
        onMessageShown(browser);
      }
    };

    /** "Message loaded" listeners added by heron: { target, fn } (removed on stop). */
    const msgListeners = new Set();
    function listenMsgLoaded(target, fn) {
      target.addEventListener("MsgLoaded", fn, true);
      msgListeners.add({ target, fn });
    }

    /** Tabs already set up (reset when modules stop). */
    let hooked = new WeakSet();

    /** Modules of each kind of window, in start order: [script, module]. */
    const MAIN_MODULES = [["window", "unifiedFolders"], ["search"], ["glance"], ["undoSend"]];
    // "threads" after "list": its conversation rows replace the sender and date.
    const PANE_MODULES = [["themePane", "theme"], ["swipe"], ["list"], ["conversation"], ["threads"]];
    const COMPOSE_MODULES = [["compose"], ["undoSendCompose", "undoSend"]];

    const runAll = (window, table) => table.forEach(([name, module]) => runModule(window, name, { module }));

    /** Sets up a mail tab (about:3pane), only once. */
    function hookAbout3Pane(win3) {
      if (!win3 || hooked.has(win3) || !win3.document?.getElementById("threadTree")) {
        return;
      }
      hooked.add(win3);
      listenMsgLoaded(win3.document, onMsgLoaded);
      runAll(win3, PANE_MODULES);
      // The message already displayed (modules restarted): MsgLoaded will not come.
      const reader = win3.document.getElementById("messageBrowser");
      if (reader?.contentDocument?.readyState == "complete") {
        onMessageShown(reader);
      }
    }

    /** A message opened on its own (overlay card): its reader is the tab itself. */
    function hookMessageTab(tab) {
      const browser = tab.chromeBrowser;
      if (!browser || hooked.has(browser)) {
        return;
      }
      hooked.add(browser);
      listenMsgLoaded(browser, () => onMessageShown(browser));
      if (browser.contentDocument?.readyState == "complete") {
        onMessageShown(browser);
      }
    }

    /** Tabs of the main window (they are created and loaded after it). */
    function hookTabs(window) {
      for (const tab of window.gTabmail?.tabInfo ?? []) {
        if (tab.mode?.name == "mail3PaneTab") {
          hookAbout3Pane(tab.chromeBrowser?.contentWindow);
        } else if (tab.mode?.name == "mailMessageTab") {
          hookMessageTab(tab);
        }
      }
    }

    const isCompose = window => window.location.href.includes("messengercompose");

    /** Undoes the lasting changes of turned-off modules (unified folders, calendar). */
    function revert(window, allOff = false) {
      const saved = config;
      if (allOff) {
        // heron is being removed: all its modules count as turned off (except what the user keeps).
        config = {
          ...config,
          removing: true,
          modules: Object.fromEntries(Object.keys(config.modules ?? {}).map(m => [m, false])),
        };
      }
      try {
        // It keeps listening (calendar) until the next module stop; when heron is turned off, until the window closes (or heron is turned back on).
        runModule(window, "revert", { force: true });
      } finally {
        config = saved;
      }
    }

    /** Starts the active modules in a Thunderbird window. */
    function startWindow(window) {
      if (isCompose(window)) {
        runAll(window, COMPOSE_MODULES);
        return;
      }
      revert(window);
      runAll(window, MAIN_MODULES);
      hookTabs(window);
    }

    /** Open Thunderbird windows (main and compose). */
    function openWindows() {
      return [...Services.wm.getEnumerator(null)].filter(
        w => alive(w) && w.document?.readyState == "complete" &&
          ["messenger.xhtml", "messengercompose.xhtml"].some(f => w.location.href.endsWith(f))
      );
    }

    /** Modules turned on or off in the options: applied right away, without restarting. */
    function restartModules() {
      stopModules();
      for (const window of openWindows()) {
        startWindow(window);
      }
    }

    const intervals = new Map();

    return {
      heron: {
        async setConfig(newConfig) {
          const modulesChanged = JSON.stringify(newConfig.modules) != JSON.stringify(config.modules);
          config = newConfig;
          updateSheets();
          updatePrefs();
          if (modulesChanged) {
            restartModules();
            return;
          }
          forgetDead();
          for (const { sandbox, follow } of running) {
            if (!follow) {
              continue;
            }
            try {
              sandbox.heronConfig = Components.utils.cloneInto(config, sandbox);
              // Modules that must react right away define heronConfigChanged().
              sandbox.heronConfigChanged?.();
            } catch (e) {
              console.error("heron: settings", e);
            }
          }
        },

        /** Status for the options page: failed modules, Thunderbird version. */
        async getStatus() {
          const current = appVersion();
          const failed = Object.entries(failures())
            .filter(([, info]) => info.version == current)
            .map(([module, info]) => ({ module, error: info.error }));
          return { version: current, failed };
        },

        /** "Retry": failed modules are restarted right away. */
        async clearFailures() {
          Services.prefs.clearUserPref(FAILED);
          updateSheets();
          updatePrefs();
          restartModules();
        },

        async init(initialConfig, translatedStrings) {
          // The extension's files, readable by Thunderbird: chrome://heron/content/...
          chromeHandle = aomStartup.registerChrome(
            Services.io.newURI("manifest.json", null, context.extension.rootURI),
            [["content", "heron", "./"]]
          );
          config = initialConfig;
          strings = translatedStrings ?? {};
          updateSheets();
          updatePrefs();
          ExtensionSupport.registerWindowListener("heron", {
            chromeURLs: [
              "chrome://messenger/content/messenger.xhtml",
              "chrome://messenger/content/messengercompose/messengercompose.xhtml",
            ],
            onLoadWindow(window) {
              if (!isCompose(window)) {
                // The system text size is known once the main window is open.
                updatePrefs();
                // Tabs are created and loaded after the window: catch them at a regular interval (cheap: a loop over a few tabs).
                intervals.set(window, window.setInterval(() => hookTabs(window), 1000));
              }
              startWindow(window);
            },
            onUnloadWindow(window) {
              intervals.delete(window);
              forgetDead();
            },
          });
          self.keptPrefs = () =>
            Object.entries(KEEPABLE_PREFS)
              .filter(([key]) => config.keep?.[key] === true)
              .map(([, pref]) => pref);
          self.stop = () => {
            ExtensionSupport.unregisterWindowListener("heron");
            for (const [window, id] of intervals) {
              window.clearInterval(id);
            }
            intervals.clear();
            stopModules();
            for (const window of openWindows()) {
              if (!isCompose(window)) {
                revert(window, true);
              }
            }
            removeSheets();
            chromeHandle?.destruct();
            chromeHandle = null;
            // An update of heron must load its new files, not the cached ones.
            Services.obs.notifyObservers(null, "startupcache-invalidate");
          };
        },
      },
    };
  }
};
