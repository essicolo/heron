// Opens the fake inbox in threaded mode and selects the "Avancement..." conversation.
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox");
const a = window.gTabmail.currentAbout3Pane;
a.displayFolder(inbox.URI);
await new Promise(r => setTimeout(r, 1500));
a.gViewWrapper.showThreaded = true;
await new Promise(r => setTimeout(r, 1000));
let idx = -1;
for (let i = 0; i < a.gDBView.rowCount; i++) {
  if (a.gDBView.getMsgHdrAt(i).mime2DecodedSubject.includes("Avancement")) { idx = i; break; }
}
a.threadTree.selectedIndex = idx;
await new Promise(r => setTimeout(r, 3000));
return { idx, rows: a.gDBView.rowCount, conv: !!a.document.querySelector("conversation-view") };
