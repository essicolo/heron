/* heron: undo what a disabled module had changed (always active).
 *
 * Run by api/implementation.js in the main window. Some modules leave a state that Thunderbird remembers on its own; when the module is disabled, we restore that state:
 * - "Unified folders": the unified section added at the top of the folder pane is removed;
 * - "Single search": the calendar event list, which was hidden, is shown again.
 * (Thunderbird settings and styles are restored by api/implementation.js.)
 */
(() => {
  // No guard against running twice: api/implementation.js runs it once per module startup, and when heron is disabled.

  const off = name => heronConfig?.modules?.[name] === false;

  // Unified folders: only remove what heron had added.
  function revertUnifiedFolders(tries = 0) {
    if (heronStopped || !off("unifiedFolders") || !Services.prefs.getBoolPref("heron.unifiedFolders.added", false)) {
      return;
    }
    // heron is being removed and the user keeps the unified folders: they become the user's own.
    if (heronConfig?.removing && heronConfig.keep?.unifiedFolders) {
      Services.prefs.clearUserPref("heron.unifiedFolders.added");
      return;
    }
    const folderPane = gTabmail?.currentAbout3Pane?.folderPane;
    if (!folderPane) {
      if (tries < 30) {
        setTimeout(() => revertUnifiedFolders(tries + 1), 1000);
      }
      return;
    }
    folderPane.activeModes = folderPane.activeModes.filter(mode => mode != "smart");
    Services.prefs.clearUserPref("heron.unifiedFolders.added");
    Services.prefs.clearUserPref("heron.unifiedFolders.applied");
  }

  // Calendar: the event list, hidden by single search, comes back when the calendar opens.
  heronListen(gTabmail.tabContainer, "TabSelect", () => {
    if (!off("search") || !Services.prefs.getBoolPref("heron.unifinder.hidden", false)) {
      return;
    }
    if (gTabmail.currentTabInfo?.mode?.name != "calendar") {
      return;
    }
    setTimeout(() => {
      if (document.getElementById("bottom-events-box")?.hidden) {
        toggleUnifinder();
      }
      Services.prefs.clearUserPref("heron.unifinder.hidden");
    }, 300);
  });

  revertUnifiedFolders();
})();
