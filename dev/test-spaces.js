// Tests the top field in Calendar, Tasks and Contacts (test profile only: the macOS address book is disabled there, see make-test-profile.sh).
const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const input = document.querySelector("global-search-bar").shadowRoot.querySelector("input");
const type = text => {
  input.focus();
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" }));
};
const out = {};

// --- Data -------------------------------------------------------------------------------
const calendar = cal.manager.getCalendars()[0];
calendar.setProperty("disabled", false);
const now = cal.dtz.now();
for (const [title, days] of [["Dentiste", 3], ["Réunion du comité", 20]]) {
  const event = new CalEvent();
  event.title = title;
  event.startDate = now.clone();
  event.startDate.day += days;
  event.endDate = event.startDate.clone();
  event.endDate.hour += 1;
  await calendar.addItem(event);
}
const todo = new CalTodo();
todo.title = "Relire le rapport";
await calendar.addItem(todo);
const book = MailServices.ab.getDirectory("jsaddrbook://abook.sqlite");
for (const [first, last, email] of [["Olivier", "Bergeron", "ob@example.com"], ["Hélène", "Côté", "hc@example.com"]]) {
  const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(Ci.nsIAbCard);
  card.firstName = first;
  card.lastName = last;
  card.displayName = `${first} ${last}`;
  card.primaryEmail = email;
  book.addCard(card);
}

// --- Calendar -----------------------------------------------------------------------------
document.getElementById("calendarButton").click();
await wait(2500);
const box = () => document.getElementById("bottom-events-box");
const rows = () => document.getElementById("unifinder-search-results-tree").view?.rowCount ?? -1;
out.calendarOpen = { listVisible: !box().hidden };
type("dentiste");
await wait(2000);
out.calendarSearch = { listVisible: !box().hidden, results: rows(), period: document.getElementById("event-filter-menulist").value };
type("");
await wait(1500);
out.calendarEmpty = { listVisible: !box().hidden, period: document.getElementById("event-filter-menulist").value };

// --- Tasks --------------------------------------------------------------------------------
document.getElementById("tasksButton").click();
await wait(2500);
const taskRows = () => document.getElementById("calendar-task-tree").view?.rowCount ?? -1;
const before = taskRows();
type("relire");
await wait(1500);
out.tasks = { before, search: taskRows(), ownFieldHidden: getComputedStyle(document.getElementById("task-text-filter-field")).display == "none" };
type("zzz-aucune");
await wait(1500);
out.tasks.searchNoResults = taskRows();

// --- Contacts -----------------------------------------------------------------------------
document.getElementById("addressBookButton").click();
await wait(3000);
const abDoc = window.gTabmail.currentTabInfo.browser.contentDocument;
const cardsShown = () => abDoc.getElementById("cards")?.view?.rowCount ?? -1;
out.contacts = { before: cardsShown(), topFieldEmpty: input.value == "" };
type("hélène");
await wait(1500);
out.contacts.search = cardsShown();
out.contacts.ownFieldHidden = abDoc.defaultView.getComputedStyle(abDoc.getElementById("searchInput")).display == "none";

// --- Back to mail: the field is cleared -----------------------------------------------------
document.getElementById("mailButton").click();
await wait(1500);
out.backToMail = { field: input.value, filters: !document.querySelector("global-search-bar").shadowRoot.querySelector("#heron-filters").hidden };
return out;
