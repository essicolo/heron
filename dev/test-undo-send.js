// Tests "Undo send": one send allowed to go out, then one send undone. Server: dev/smtp-sink.py.
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const outbox = MailServices.accounts.localFoldersServer.rootFolder.getFolderWithFlags(Ci.nsMsgFolderFlags.Queue);
const received = async () => (await IOUtils.getChildren("/tmp/heron-smtp")).length;
const toast = () => { const el = document.getElementById("heron-undo-send"); return el && !el.hidden ? el.querySelector("span").textContent : null; };
const composeWindows = () => [...Services.wm.getEnumerator("msgcompose")];

async function compose(subject) {
  const params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
  params.type = Ci.nsIMsgCompType.New;
  params.format = Ci.nsIMsgCompFormat.PlainText;
  params.identity = MailServices.accounts.getIdentity("id1");
  const fields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
  fields.to = "Olivier Bergeron <ob@example.com>";
  fields.subject = subject;
  fields.body = "Bonjour Olivier, voici le message de test.";
  params.composeFields = fields;
  MailServices.compose.OpenComposeWindowWithParams(null, params);
  await wait(4000);
  return Services.wm.getMostRecentWindow("msgcompose");
}

const out = {};
// 1. Let it go.
let w = await compose("Test let go");
w.goDoCommand("cmd_sendButton");
await wait(2500);
out.pending = { outbox: outbox.getTotalMessages(false), notification: toast(), received: await received(), composeWindows: composeWindows().length };
await wait(10000);
out.afterDelay = { outbox: outbox.getTotalMessages(false), notification: toast(), received: await received() };

// 2. Undo.
w = await compose("Test undone");
w.goDoCommand("cmd_sendButton");
await wait(2500);
out.pending2 = { outbox: outbox.getTotalMessages(false), notification: toast() };
document.querySelector("#heron-undo-send button").click();
await wait(6000);
const reopened = Services.wm.getMostRecentWindow("msgcompose");
out.undone = {
  windowReopened: !!reopened,
  subject: reopened?.document.getElementById("msgSubject")?.value,
  outbox: outbox.getTotalMessages(false),
  notification: toast(),
};
await wait(9000);
out.nothingSent = { received: await received() };
return out;
