// Opens a test compose window. Replace FORMAT with Default (HTML) or PlainText.
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const id = MailServices.accounts.getIdentity("id1");
const params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
params.type = Ci.nsIMsgCompType.New;
params.format = Ci.nsIMsgCompFormat.FORMAT;
params.identity = id;
const fields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
fields.to = "Olivier Bergeron <ob@example.com>";
fields.subject = "Compose test";
params.composeFields = fields;
MailServices.compose.OpenComposeWindowWithParams(null, params);
await new Promise(r => setTimeout(r, 5000));
return "ok";
