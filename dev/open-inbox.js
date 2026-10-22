const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox");
const a = window.gTabmail.currentAbout3Pane;
a.displayFolder(inbox.URI);
await new Promise(r => setTimeout(r, 1500));
a.threadTree.selectedIndex = 1;
await new Promise(r => setTimeout(r, 1500));
return "ok";
