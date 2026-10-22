/* heron: undo send, compose window side (module "undoSend").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the compose window. Every send (Send button, ⌘↩, menu) goes through GenericSendMessage(mode): an immediate send becomes a queued message in the Outbox ("Send Later"), and the main window (undo-send.js) sends it after the chosen delay, unless undone.
 *
 * To be safe, we do not intercept if the Outbox already holds messages: those were queued on purpose, and they would be sent at the same time.
 */
(() => {
  if (window.__heronUndoSend) {
    return;
  }
  window.__heronUndoSend = true;
  heronOnStop(() => delete window.__heronUndoSend);

  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

  if (typeof window.GenericSendMessage != "function") {
    throw new Error("GenericSendMessage not found: sending left to Thunderbird");
  }

  const seconds = () => Number(heronConfig?.undoSendSeconds ?? 10);

  function outboxIsEmpty() {
    const outbox = MailServices.accounts.localFoldersServer?.rootFolder?.getFolderWithFlags(
      Ci.nsMsgFolderFlags.Queue
    );
    return !outbox || outbox.getTotalMessages(false) == 0;
  }

  heronWrap(window, "GenericSendMessage", original => function (mode, ...rest) {
    const D = Ci.nsIMsgCompDeliverMode;
    const immediate = mode == D.Now || mode == D.Background;
    if (immediate && seconds() > 0 && !Services.io.offline && outboxIsEmpty()) {
      Services.obs.notifyObservers(
        null,
        "heron-send-held",
        JSON.stringify({
          identity: window.gCurrentIdentity?.key ?? null,
          seconds: seconds(),
          subject: document.getElementById("msgSubject")?.value ?? "",
        })
      );
      return original.call(this, D.Later, ...rest);
    }
    return original.call(this, mode, ...rest);
  });
})();
