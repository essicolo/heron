// Selects the message whose subject contains SUBJECT in the demo inbox (threads stay collapsed: a thread row opens the conversation view).
const a = window.gTabmail.currentAbout3Pane;
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox");
if (a.gFolder?.URI != inbox.URI) {
  a.displayFolder(inbox.URI);
  await new Promise(r => setTimeout(r, 1500));
}
a.threadTree.scrollToIndex(0);
let index = -1;
for (let i = 0; i < a.gDBView.rowCount; i++) {
  if (a.gDBView.getMsgHdrAt(i).mime2DecodedSubject.includes(SUBJECT)) {
    index = i;
    break;
  }
}
a.threadTree.selectedIndex = index;
await new Promise(r => setTimeout(r, 3000));
return index;
