// Recipients: "N more" expands the list, "Show less" collapses it; the next message is shown collapsed; in a conversation card, the card follows the header height. Test profile.
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const a = window.gTabmail.currentAbout3Pane;
const folder = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Recipients");
a.displayFolder(folder.URI);
await wait(1500);
const [first, second] = [...folder.messages].sort((x, y) => x.date - y.date);

/** State of a reader's "To" row. */
const state = doc => {
  const row = doc.getElementById("expandedtoBox");
  return {
    shown: row.querySelectorAll("li[is='header-recipient']").length,
    more: Boolean(row.querySelector(".show-more-recipients:not(.heron-less)")?.isConnected),
    less: Boolean(row.querySelector(".heron-less")),
    // "Show less" must be visible without scrolling the header.
    lessVisible: (() => {
      const b = row.querySelector(".heron-less")?.getBoundingClientRect();
      const h = doc.getElementById("messageHeader").getBoundingClientRect();
      return Boolean(b) && b.top >= h.top && b.bottom <= h.bottom;
    })(),
  };
};
const out = {};

// 1. Reading pane
a.messagePane.displayMessage(folder.getUriForMsg(first));
await wait(2000);
let doc = a.document.getElementById("messageBrowser").contentDocument;
out.reading = { start: state(doc) };
doc.getElementById("expandedtoBox").moreButton.click();
await wait(400);
out.reading.expanded = state(doc);
doc.querySelector("#expandedtoBox .heron-less")?.click();
await wait(400);
out.reading.collapsed = state(doc);
doc.getElementById("expandedtoBox").moreButton.click();
await wait(300);
a.messagePane.displayMessage(folder.getUriForMsg(second));
await wait(2000);
out.reading.nextMessage = state(doc);

// 2. Conversation card
a.gViewWrapper.showThreaded = true;
await wait(800);
a.threadTree.selectedIndex = 0;
await wait(3500);
const card = [...a.document.querySelectorAll("#heron-conversation .heron-msg")].find(c => c.querySelector("browser"));
const browser = card?.querySelector("browser");
if (browser) {
  doc = browser.contentDocument;
  const height = () => Math.round(browser.getBoundingClientRect().height);
  out.card = { start: { ...state(doc), height: height() } };
  doc.getElementById("expandedtoBox").moreButton.click();
  await wait(800);
  out.card.expanded = { ...state(doc), height: height() };
  doc.querySelector("#expandedtoBox .heron-less")?.click();
  await wait(800);
  out.card.collapsed = { ...state(doc), height: height() };
}
return out;
