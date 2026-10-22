/* heron: unified folders (module "unifiedFolders").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the main window.
 *
 * - Unified folders: with at least two mail accounts, the folder pane starts with the Thunderbird unified folders (all inboxes, all sent...), like Apple Mail. Applied only once: a later choice made in Thunderbird is respected.
 */
(() => {
  if (window.__heronWindow) {
    return;
  }
  window.__heronWindow = true;
  heronOnStop(() => delete window.__heronWindow);

  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

  // --- Unified folders --------------------------------------------------------------------

  const UNIFIED_DONE = "heron.unifiedFolders.applied";

  function mailAccountCount() {
    return MailServices.accounts.accounts.filter(account =>
      ["imap", "pop3", "owl", "ews"].includes(account.incomingServer?.type)
    ).length;
  }

  function applyUnifiedFolders() {
    if (Services.prefs.getBoolPref(UNIFIED_DONE, false)) {
      return;
    }
    const folderPane = gTabmail?.currentAbout3Pane?.folderPane;
    if (!folderPane) {
      return; // the mail tab is not ready yet: we will retry
    }
    const forced = Services.prefs.getBoolPref("heron.unifiedFolders.force", false);
    if (mailAccountCount() >= 2 || forced) {
      if (!folderPane.activeModes.includes("smart")) {
        folderPane.activeModes = ["smart", ...folderPane.activeModes];
        Services.prefs.setBoolPref("heron.unifiedFolders.added", true);
      }
    }
    Services.prefs.setBoolPref(UNIFIED_DONE, true);
  }

  // --- Startup and settings changes --------------------------------------------------------

  (function waitForMailTab(tries = 0) {
    if (heronStopped) {
      return;
    }
    applyUnifiedFolders();
    if (!Services.prefs.getBoolPref(UNIFIED_DONE, false) && tries < 30) {
      setTimeout(() => waitForMailTab(tries + 1), 1000);
    }
  })();
})();
