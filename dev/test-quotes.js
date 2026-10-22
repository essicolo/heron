// Quoted text: for each message in dev/fixtures/quotes ("Quotes" folder), checks the expected number of "•••" buttons (X-Heron-Expect header), that the NOUVEAU (new) text is visible, and that ANCIEN (old) and SIGNATURE are hidden. Test profile only.
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const a = window.gTabmail.currentAbout3Pane;
const folder = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Quotes");
a.displayFolder(folder.URI);
await wait(1500);

/** Is the text visible? (an ancestor folded by heron hides it) */
function visible(doc, marker) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.data.includes(marker)) {
      return !n.parentElement.closest(".heron-folded");
    }
  }
  return null; // not found
}

const out = {};
const only = typeof ONLY == "string" ? ONLY : null; // a single message (screenshot)
for (const hdr of [...folder.messages]) {
  if (only && hdr.mime2DecodedSubject != only) {
    continue;
  }
  a.messagePane.displayMessage(folder.getUriForMsg(hdr));
  await wait(1800);
  const doc = a.document.getElementById("messageBrowser").contentDocument.getElementById("messagepane").contentDocument;
  const expected = Number(/X-Heron-Expect: (\d)/.exec(await new Promise(resolve => {
    // The header is not in the database: read it from the message source.
    const listener = { data: "", onStartRequest() {}, onStopRequest() { resolve(this.data); },
      onDataAvailable(r, stream, o, count) { const s = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream); s.init(stream); this.data += s.read(count); } };
    MailServices.messageServiceFromURI(folder.getUriForMsg(hdr)).streamMessage(folder.getUriForMsg(hdr), listener, null, null, false, "", false);
  }))?.[1] ?? -1);
  const toggles = doc.querySelectorAll(".heron-toggle").length;
  const result = {
    buttons: toggles,
    expected,
    newVisible: visible(doc, "NOUVEAU"),
    oldHidden: expected ? visible(doc, "ANCIEN") === false : true,
    signatureHidden: visible(doc, "SIGNATURE") !== true,
  };
  // One click expands the whole history, a second one collapses it.
  const button = doc.querySelector(".heron-toggle");
  if (button) {
    button.click();
    result.expandable = visible(doc, "ANCIEN") === true;
    button.click();
    result.expandable &&= visible(doc, "ANCIEN") === false;
  }
  result.ok = result.buttons == expected && result.newVisible && result.oldHidden && result.signatureHidden &&
    (!button || result.expandable);
  out[hdr.mime2DecodedSubject] = result;
}
return out;
