// Forces Gloda indexing of the fake mailbox, then waits until a search finds it.
const { GlodaIndexer } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaIndexer.sys.mjs");
const { GlodaMsgIndexer } = ChromeUtils.importESModule("resource:///modules/gloda/IndexMsg.sys.mjs");
const { GlodaMsgSearcher } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaMsgSearcher.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const root = MailServices.accounts.localFoldersServer.rootFolder;
// A local folder that was never opened is not parsed yet: open it once, otherwise Gloda skips it.
const a = window.gTabmail.currentAbout3Pane;
for (const name of ["Sent", "Inbox"]) {
  a.displayFolder(root.getChildNamed(name).URI);
  await new Promise(r => setTimeout(r, 1500));
}
for (const name of ["Inbox", "Sent"]) {
  GlodaMsgIndexer.indexFolder(root.getChildNamed(name), { force: true });
}
for (let i = 0; i < 90; i++) {
  const n = await new Promise(resolve => {
    const c = new GlodaMsgSearcher(null, "rapport").getCollection();
    c.listener = { onItemsAdded() {}, onItemsModified() {}, onItemsRemoved() {}, onQueryCompleted: () => resolve(c.items.length) };
  });
  if (n >= 5 && !GlodaIndexer.indexing) return { indexed: n, waited: i };
  await new Promise(r => setTimeout(r, 1000));
}
return { indexed: 0 };
