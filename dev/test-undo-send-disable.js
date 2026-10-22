// Undo send: heron disabled during the delay, so the message goes out right away (never stuck in the outbox). Server: dev/smtp-sink.py. Test profile only.
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

const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const addon = await AddonManager.getAddonByID("heron@essia");
const w = await compose("Test disabled during the delay");
w.goDoCommand("cmd_sendButton");
await wait(2500);
const out = { pending: { outbox: outbox.getTotalMessages(false), notification: toast(), received: await received() } };
await addon.disable();
await wait(4000); // well before the 10 s delay ends
out.afterDisable = { outbox: outbox.getTotalMessages(false), notification: toast(), received: await received() };
await addon.enable();
await wait(4000);
return out;
