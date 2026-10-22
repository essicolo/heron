// Tests the suggestions under the top field (test profile: fake contacts only).
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const book = MailServices.ab.getDirectory("jsaddrbook://abook.sqlite");
const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(Ci.nsIAbCard);
card.displayName = "Léa-Émilie Fortin";
card.primaryEmail = "lef@example.com";
book.addCard(card);
await wait(300);
const input = document.querySelector("global-search-bar").shadowRoot.querySelector("input");
const type = text => {
  input.focus();
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" }));
};
const list = () => [...document.querySelectorAll("#heron-suggest li")].map(li => li.textContent + (li.getAttribute("aria-selected") == "true" ? " ←" : ""));
const out = {};
type("lea");
await wait(600);
out.suggestions = list();
out.thunderbirdMenuOpen = !!document.querySelector("global-search-bar").popup?.mPopupOpen;
// Keyboard: Down x4 (4th = the contact), Enter.
for (let i = 0; i < 4; i++) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
}
await wait(100);
out.highlighted = list().find(l => l.endsWith("←"));
input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }));
await wait(1500);
out.fieldAfterChoice = input.value;
out.suggestionsClosed = document.getElementById("heron-suggest").hidden;
out.rows = window.gTabmail.currentAbout3Pane.gDBView.rowCount;
out.tabs = window.gTabmail.tabInfo.length;
return out;
