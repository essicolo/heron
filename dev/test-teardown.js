// Teardown: heron disabled without a restart must leave nothing behind; re-enabled, it comes back; a module turned off in the options disappears right away (and comes back when turned on again).
// Run after dev/open-thread.js (a conversation shown). Test profile only.
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const { ExtensionStorageIDB } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorageIDB.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const a = () => window.gTabmail.currentAbout3Pane;
const ID = "heron@essia";

/** What heron left in the windows: elements, attributes, wrappers. */
function leftovers() {
  const found = [];
  const docs = [document, a().document];
  const reader = a().document.getElementById("messageBrowser")?.contentDocument;
  if (reader) {
    docs.push(reader, reader.getElementById("messagepane")?.contentDocument);
  }
  const bar = document.querySelector("global-search-bar")?.shadowRoot;
  for (const doc of [...docs, bar].filter(Boolean)) {
    for (const el of doc.querySelectorAll('[id^="heron-"], [class*="heron-"]')) {
      found.push(`${el.localName}#${el.id || el.className}`);
    }
    const root = doc.documentElement;
    for (const attr of root?.attributes ?? []) {
      if (attr.name.startsWith("heron") || attr.name.startsWith("data-heron")) {
        found.push(`attribute ${attr.name}`);
      }
    }
  }
  for (const flag of ["__heronSearch", "__heronGlance", "__heronWindow", "__heronUndoSendMain"]) {
    if (window[flag]) {
      found.push(flag);
    }
  }
  const wrapped = (name, fn) => String(fn).includes("active ? wrapped") && found.push(`wrapper ${name}`);
  wrapped("displayMessages", a().messagePane.displayMessages);
  wrapped("fillRow", a().customElements.get("thread-card")?.prototype.fillRow);
  if (getComputedStyle(document.getElementById("tabs-toolbar")).display == "none") {
    found.push("tab bar hidden");
  }
  return found;
}

/** Visible heron effects, to check that it came back. */
const present = () => ({
  conversation: Boolean(a().document.querySelector("#heron-conversation:not([hidden])")),
  domains: a().document.querySelectorAll(".heron-domain").length > 0,
  filters: Boolean(document.querySelector("global-search-bar")?.shadowRoot?.querySelector("#heron-filters")),
  density: Services.prefs.getIntPref("mail.uidensity", 1),
});

async function setModules(modules) {
  const extension = WebExtensionPolicy.getByID(ID).extension;
  const db = await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(extension));
  const { config: old = {} } = await db.get("config");
  const config = { ...old, modules: { ...old.modules, ...modules } };
  ExtensionStorageIDB.notifyListeners(ID, await db.set({ config }));
  await wait(2500);
}

/** Reselects the conversation (to see which view shows it). */
async function reselect() {
  const tree = a().threadTree;
  const index = tree.selectedIndex;
  tree.selectedIndex = -1;
  await wait(300);
  tree.selectedIndex = index;
  await wait(2500);
}

const out = { before: present() };
const addon = await AddonManager.getAddonByID(ID);

// 1. Disable
await addon.disable();
await wait(3000);
out.disabled = {
  leftovers: leftovers(),
  density: Services.prefs.getIntPref("mail.uidensity", 1),
  // The selected thread falls back to the stock Thunderbird display (thread summary).
  thunderbirdView: !a().document.getElementById("multiMessageBrowser").hidden,
};

// 2. Re-enable
await addon.enable();
await wait(5000);
await reselect();
out.reenabled = present();

// 3. Modules turned off, then back on, live
await setModules({ conversation: false, list: false, search: false });
await reselect();
out.modulesOff = present();
await setModules({ conversation: true, list: true, search: true });
await reselect();
out.modulesBackOn = present();

return out;
