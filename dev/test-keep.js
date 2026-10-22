// "If I remove heron...": checked settings stay, the others are restored. Test profile, with heron.unifiedFolders.force (unified folders added despite a single account).
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const { ExtensionStorageIDB } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorageIDB.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const ID = "heron@essia";
const state = () => ({
  density: Services.prefs.getIntPref("mail.uidensity", 1),
  fontSize: Services.prefs.getIntPref("mail.uifontsize", 0),
  nameOnly: Services.prefs.getIntPref("mail.addressDisplayFormat", 0) == 2,
  dark: Services.prefs.getBoolPref("mail.dark-reader.enabled", false),
  unified: window.gTabmail.currentAbout3Pane.folderPane.activeModes.includes("smart"),
});
async function setKeep(keep) {
  const extension = WebExtensionPolicy.getByID(ID).extension;
  const db = await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(extension));
  const { config: old = {} } = await db.get("config");
  ExtensionStorageIDB.notifyListeners(ID, await db.set({ config: { ...old, keep } }));
  await wait(1500);
}
const addon = await AddonManager.getAddonByID(ID);
const out = { active: state() };
await setKeep({ density: true, unifiedFolders: true });
await addon.disable();
await wait(3000);
out.removedKeeping = state();
await addon.enable();
await wait(5000);
await setKeep({});
await addon.disable();
await wait(3000);
// The kept density has become the user's own: it stays, even with nothing checked.
out.removedNotKeeping = state();
await addon.enable();
await wait(4000);
return out;
