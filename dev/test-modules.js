// Reports, for each heron module, whether its effects are present (true) or absent (false).
// Run after dev/open-inbox.js and dev/wait-index.js. Test profile only.
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const a = () => window.gTabmail.currentAbout3Pane;
const doc = () => a().document;
const flag = name => Boolean(doc().documentElement.dataset[name]);
const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox");
const out = {};
const errors = {};
const check = async (name, fn) => {
  try {
    out[name] = Boolean(await fn());
  } catch (e) {
    out[name] = false;
    errors[name] = String(e);
  }
};

await check("theme", () => {
  const card = doc().querySelector("#threadTree tr.card-layout .card-container");
  return a().getComputedStyle(card).backgroundImage.includes("gradient") &&
    Services.prefs.getIntPref("mail.uidensity") == 2 && flag("heronThemePane");
});
await check("list", () =>
  flag("heronList") && [...doc().querySelectorAll(".heron-domain")].some(d => d.textContent));
await check("threads", () =>
  flag("heronThreads") && a().gViewWrapper.showThreaded &&
  [...doc().querySelectorAll(".heron-count")].some(c => c.textContent));
await check("swipe", () => flag("heronSwipe"));
await check("search", () => {
  const bar = document.querySelector("global-search-bar");
  return Boolean(bar.shadowRoot.querySelector("#heron-filters")) &&
    a().getComputedStyle(doc().getElementById("threadPaneQuickFilterButton")).display == "none";
});
await check("glance", () =>
  Boolean(window.__heronGlance) && getComputedStyle(document.getElementById("tabs-toolbar")).display == "none");
await check("undoSend", () => Boolean(window.__heronUndoSendMain));
await check("unifiedFolders", () => a().folderPane.activeModes.includes("smart"));

// Conversation: select the test thread.
await check("conversation", async () => {
  a().gViewWrapper.showThreaded = true;
  await wait(800);
  let idx = -1;
  for (let i = 0; i < a().gDBView.rowCount; i++) {
    if (a().gDBView.getMsgHdrAt(i).mime2DecodedSubject.includes("Avancement")) {
      idx = i;
      break;
    }
  }
  if (a().gDBView.isContainer(idx) && a().gDBView.isContainerOpen(idx)) {
    a().gDBView.toggleOpenState(idx);
  }
  a().threadTree.selectedIndex = idx;
  await wait(3000);
  const view = doc().getElementById("heron-conversation");
  return flag("heronConversation") && view && !view.hidden && view.querySelectorAll(".heron-msg").length > 1;
});

// Quoted text: a message with a quote, shown on its own.
await check("foldQuotes", async () => {
  let uri;
  for (const h of inbox.messages) {
    if (h.messageId == "thread-2@heron.test") {
      uri = inbox.getUriForMsg(h);
    }
  }
  a().messagePane.displayMessage(uri);
  await wait(3000);
  const body = doc().getElementById("messageBrowser").contentDocument.querySelector("#messagepane").contentDocument;
  return body.querySelectorAll(".heron-toggle").length > 0;
});

// Trackers: the test newsletter.
await check("trackers", async () => {
  let uri;
  for (const h of inbox.messages) {
    if (h.messageId == "infolettre-1@heron.test") {
      uri = inbox.getUriForMsg(h);
    }
  }
  a().messagePane.displayMessage(uri);
  await wait(3500);
  return Boolean(doc().getElementById("messageBrowser").contentDocument.getElementById("heron-trackers"));
});

// Compose: Aa (compose module) and send interception (undoSend module).
{
  const params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
  params.type = Ci.nsIMsgCompType.New;
  params.format = Ci.nsIMsgCompFormat.Default;
  params.identity = MailServices.accounts.getIdentity("id1");
  params.composeFields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
  MailServices.compose.OpenComposeWindowWithParams(null, params);
  await wait(4000);
  const w = Services.wm.getMostRecentWindow("msgcompose");
  await check("compose", () => Boolean(w.document.getElementById("heron-format-toggle")));
  await check("undoSendCompose", () => Boolean(w.__heronUndoSend) && String(w.GenericSendMessage).includes("active ? wrapped"));
  w.close();
}

return { out, errors, failed: JSON.parse(Services.prefs.getStringPref("extensions.heron.failedModules", "{}")) };
