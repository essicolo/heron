/* heron: unified advanced search, without tabs (module "search").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the main window (messenger.xhtml): `window`, `document`, `gTabmail`, `ChromeUtils`, `Ci` are available there.
 *
 * The "Search..." field at the top is the only search:
 * - type free text and, optionally, keywords:
 *     de:olivier  à:léa  objet:rapport  contient:"phrase"  depuis:2026-08-01  avant:2026-09-01
 *     dossier:envoyés  pj  non-lu  drapeau  (English aliases: from: to: subject: after: before: in:)
 * - the filter button inside the field opens a panel that writes these same keywords (and reads them back);
 * - the open folder's list is filtered immediately; a "<folder> · N | All folders · M" bar appears above the list;
 * - Enter, or "All folders", shows results from every folder IN THE CURRENT TAB'S LIST (synthetic view) instead of opening a results tab;
 * - clearing the field, Escape, or choosing a folder brings the list back to the original folder.
 */
(() => {
  if (window.__heronSearch) {
    return;
  }
  window.__heronSearch = true;
  heronOnStop(() => delete window.__heronSearch);

  const { GlodaMsgSearcher } = ChromeUtils.importESModule(
    "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs"
  );
  const { GlodaSyntheticView } = ChromeUtils.importESModule(
    "resource:///modules/gloda/GlodaSyntheticView.sys.mjs"
  );
  const { Gloda } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaPublic.sys.mjs");
  const { GlodaConstants } = ChromeUtils.importESModule(
    "resource:///modules/gloda/GlodaConstants.sys.mjs"
  );
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);
  const uiLang = Services.locale.appLocaleAsBCP47;
  const plural = new Intl.PluralRules(uiLang);

  const DEBOUNCE_MS = 350;
  /** Number of recent messages scanned when the full-text search is not enough. */
  const RECENT_LIMIT = 5000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ==========================================================================================
  // Query: parsing and writing keywords
  // ==========================================================================================

  /** Lowercase without accents, so "Léa" matches "lea". */
  const norm = s => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  const FIELD_KEYS = {
    de: "from", from: "from",
    a: "to", to: "to", para: "to",
    objet: "subject", sujet: "subject", subject: "subject", asunto: "subject",
    contient: "text", body: "text", contiene: "text",
    depuis: "after", apres: "after", after: "after", desde: "after",
    avant: "before", before: "before", antes: "before",
    dossier: "folder", in: "folder", folder: "folder", carpeta: "folder",
    etiquette: "tag", tag: "tag", label: "tag", etiqueta: "tag",
  };
  const FLAG_WORDS = {
    pj: "attachment", "piece-jointe": "attachment", "pieces-jointes": "attachment", "has:attachment": "attachment",
    "non-lu": "unread", "non-lus": "unread", nonlu: "unread", "is:unread": "unread",
    drapeau: "flagged", etoile: "flagged", "is:flagged": "flagged",
    adjunto: "attachment", adjuntos: "attachment",
    "no-leido": "unread", "no-leidos": "unread",
    estrella: "flagged", destacado: "flagged",
  };

  const emptyQuery = () => ({
    text: [], from: [], to: [], subject: [],
    after: null, before: null, folder: null, tag: [],
    attachment: false, unread: false, flagged: false,
  });

  /** "2026-08-01" → Date (local midnight), otherwise null. */
  function parseDay(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  const formatDay = date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  /** Field text → query. Quotes group a phrase: de:"Olivier B". */
  function parseQuery(input) {
    const q = emptyQuery();
    const source = input.replace(/\bnon\s+lus?\b/gi, "non-lu").replace(/\bno\s+le[ií]dos?(?![\p{L}])/giu, "no-leido");
    const tokenRe = /(?:([^\s:"]+):)?"([^"]*)"?|(\S+)/g;
    for (const m of source.matchAll(tokenRe)) {
      let key = m[1] ?? null;
      let value = m[2];
      if (value === undefined) {
        const raw = m[3];
        if (FLAG_WORDS[norm(raw)]) {
          q[FLAG_WORDS[norm(raw)]] = true;
          continue;
        }
        const colon = raw.indexOf(":");
        if (colon > 0 && FIELD_KEYS[norm(raw.slice(0, colon))]) {
          key = raw.slice(0, colon);
          value = raw.slice(colon + 1);
        } else {
          key = null;
          value = raw;
        }
      }
      if (!value) {
        continue;
      }
      const field = key ? FIELD_KEYS[norm(key)] : "text";
      if (!field) {
        q.text.push(`${key}:${value}`);
      } else if (field == "after" || field == "before") {
        const day = parseDay(value);
        if (day) {
          q[field] = day;
        } else {
          q.text.push(`${key}:${value}`);
        }
      } else if (field == "folder") {
        q.folder = value;
      } else {
        q[field].push(value);
      }
    }
    return q;
  }

  const quote = v => (/\s/.test(v) ? `"${v}"` : v);

  /** Keywords written by the panel, in the UI language (input accepts both). */
  const KEYWORDS = uiLang.startsWith("fr")
    ? { from: "de", to: "à", subject: "objet", after: "depuis", before: "avant", folder: "dossier", tag: "étiquette",
        attachment: "pj", unread: "non-lu", flagged: "drapeau" }
    : uiLang.startsWith("es")
      ? { from: "de", to: "para", subject: "asunto", after: "desde", before: "antes", folder: "carpeta", tag: "etiqueta",
          attachment: "adjunto", unread: "no-leido", flagged: "estrella" }
      : { from: "from", to: "to", subject: "subject", after: "after", before: "before", folder: "in", tag: "tag",
          attachment: "has:attachment", unread: "is:unread", flagged: "is:flagged" };

  /** Query → field text (canonical form). */
  function formatQuery(q) {
    const k = KEYWORDS;
    const parts = [...q.text.map(quote)];
    q.from.forEach(v => parts.push(`${k.from}:${quote(v)}`));
    q.to.forEach(v => parts.push(`${k.to}:${quote(v)}`));
    q.subject.forEach(v => parts.push(`${k.subject}:${quote(v)}`));
    if (q.after) parts.push(`${k.after}:${formatDay(q.after)}`);
    if (q.before) parts.push(`${k.before}:${formatDay(q.before)}`);
    if (q.folder) parts.push(`${k.folder}:${quote(q.folder)}`);
    q.tag.forEach(v => parts.push(`${k.tag}:${quote(v)}`));
    if (q.attachment) parts.push(k.attachment);
    if (q.unread) parts.push(k.unread);
    if (q.flagged) parts.push(k.flagged);
    return parts.join(" ");
  }

  const isEmptyQuery = q =>
    !q.text.length && !q.from.length && !q.to.length && !q.subject.length &&
    !q.after && !q.before && !q.folder && !q.tag.length && !q.attachment && !q.unread && !q.flagged;

  /** Does the query use anything besides free text? (filter button active) */
  const hasFilters = q =>
    q.from.length || q.to.length || q.subject.length || q.after || q.before || q.folder || q.tag.length ||
    q.attachment || q.unread || q.flagged;

  // ==========================================================================================
  // "This folder" scope: search terms applied to the list
  // ==========================================================================================

  // --- Tags ("Important", "Work"...) ------------------------------------------------------------

  /** Thunderbird's tags: [{ key, name }]. */
  const allTags = () => MailServices.tags.getAllTags().map(tag => ({ key: tag.key, name: tag.tag }));

  /** Tag keys matching a typed value: by name (accents and case ignored, part of the name is enough) or by key ("$label1"). A value that matches no tag matches no message. */
  function tagKeys(value) {
    const keys = allTags()
      .filter(tag => has(tag.name, value) || tag.key.toLowerCase() == value.toLowerCase())
      .map(tag => tag.key);
    return keys.length ? keys : ["heron-no-such-tag"];
  }

  /** The message's tag keys. */
  const keywordsOf = hdr => (hdr?.getStringProperty("keywords") ?? "").split(" ").filter(Boolean);

  /** The body is searched only if the folder is available offline (otherwise: slow server query). */
  function canSearchBody(folder) {
    const type = folder?.server?.type;
    return type == "none" || type == "pop3" || Boolean(folder?.getFlag(Ci.nsMsgFolderFlags.Offline));
  }

  function buildFolderTerms(about3Pane, q) {
    const session = about3Pane.gViewWrapper.search.session;
    const A = Ci.nsMsgSearchAttrib;
    const O = Ci.nsMsgSearchOp;
    const terms = [];

    const add = (attrib, fill, op, { and = true, begin = false } = {}) => {
      const term = session.createTerm();
      term.attrib = attrib;
      const value = term.value;
      value.attrib = attrib;
      fill(value);
      term.value = value;
      term.op = op;
      term.booleanAnd = and;
      term.beginsGrouping = begin;
      terms.push(term);
      return term;
    };
    const contains = (attrib, str, opts) => add(attrib, v => (v.str = str), O.Contains, opts);
    const status = (flag, op) => add(A.MsgStatus, v => (v.status = flag), op);
    const date = (day, op) => add(A.Date, v => (v.date = day.getTime() * 1000), op);

    // Free text: in the sender OR the recipients OR the subject (OR the body).
    const textFields = [A.Sender, A.ToOrCC, A.Subject];
    if (canSearchBody(about3Pane.gFolder)) {
      textFields.push(A.Body);
    }
    for (const phrase of q.text) {
      let last;
      textFields.forEach((attrib, i) => {
        last = contains(attrib, phrase, { and: i == 0, begin: i == 0 });
      });
      last.endsGrouping = true;
    }
    q.from.forEach(v => contains(A.Sender, v));
    q.to.forEach(v => contains(A.ToOrCC, v));
    q.subject.forEach(v => contains(A.Subject, v));
    // Tags: one of the matching tags (several tags can match a partial name).
    for (const value of q.tag) {
      const keys = tagKeys(value);
      let last;
      keys.forEach((key, i) => {
        last = add(A.Keywords, v => (v.str = key), O.Contains, { and: i == 0, begin: i == 0 });
      });
      last.endsGrouping = true;
    }
    if (q.attachment) status(Ci.nsMsgMessageFlags.Attachment, O.Is);
    if (q.unread) status(Ci.nsMsgMessageFlags.Read, O.Isnt);
    if (q.flagged) status(Ci.nsMsgMessageFlags.Marked, O.Is);
    // "depuis" includes the given day; "avant" excludes it. ("Is after" compares by day.)
    if (q.after) date(new Date(q.after.getTime() - DAY_MS), O.IsAfter);
    if (q.before) date(q.before, O.IsBefore);
    return terms;
  }

  function applyFolderQuery(about3Pane, q) {
    const search = about3Pane.gViewWrapper?.search;
    if (!search) {
      return;
    }
    search.userTerms = q && !isEmptyQuery(q) ? buildFolderTerms(about3Pane, q) : null;
  }

  // ==========================================================================================
  // "All folders" scope: Gloda index, then precise filtering
  // ==========================================================================================

  const has = (haystack, needle) => norm(haystack).includes(norm(needle));
  const identityText = i => `${i?.contact?.name ?? ""} ${i?.value ?? ""}`;

  function matchesAll(m, q) {
    const hdr = m.folderMessage;
    const folderName = hdr?.folder?.localizedName ?? m.folder?.name ?? "";
    const recipients = [...(m.to ?? []), ...(m.cc ?? [])];
    return (
      q.from.every(v => has(identityText(m.from), v)) &&
      q.to.every(v => recipients.some(i => has(identityText(i), v))) &&
      q.subject.every(v => has(m.subject, v)) &&
      (!q.attachment || m.attachmentNames?.length > 0 || Boolean(hdr && hdr.flags & Ci.nsMsgMessageFlags.Attachment)) &&
      (!q.unread || Boolean(hdr && !hdr.isRead)) &&
      (!q.flagged || Boolean(m.starred) || Boolean(hdr?.isFlagged)) &&
      (!q.after || m.date >= q.after) &&
      (!q.before || m.date < q.before) &&
      (!q.folder || has(folderName, q.folder)) &&
      q.tag.every(v => tagKeys(v).some(key => keywordsOf(hdr).includes(key)))
    );
  }

  /** Runs the "all folders" search; updates the count, and the list if the scope is "all". */
  function queryAll() {
    const s = state;
    if (!s) {
      return;
    }
    const q = s.query;
    const token = (s.token = (s.token ?? 0) + 1);
    const done = items => {
      if (state != s || s.token != token) {
        return; // a newer keystroke replaced this query
      }
      s.allItems = items.filter(m => matchesAll(m, q));
      renderScopeBar();
      if (s.scope == "all") {
        showAllResults();
      }
    };
    const listener = (collection, onItems) => ({
      onItemsAdded() {},
      onItemsModified() {},
      onItemsRemoved() {},
      onQueryCompleted: () => onItems(collection().items),
    });

    // Recent messages from the index (within the requested dates), then filtered by our criteria.
    // Used when there are only filters, or when the full-text search finds nothing (it does not fold accents: "lea" does not find "Léa").
    const recent = () => {
      const query = Gloda.newQuery(GlodaConstants.NOUN_MESSAGE);
      if (q.after || q.before) {
        query.dateRange([q.after ?? new Date(0), q.before ?? new Date(Date.now() + DAY_MS)]);
      }
      query.orderBy("-date");
      query.limit(RECENT_LIMIT);
      let collection = null;
      collection = query.getCollection(listener(() => collection, done));
    };

    // Known text (free, sender, recipient, subject): full-text search of the index.
    const seed = [...q.text, ...q.from, ...q.to, ...q.subject].join(" ").trim();
    if (!seed) {
      recent();
      return;
    }
    const collection = new GlodaMsgSearcher(null, seed).getCollection();
    collection.listener = listener(
      () => collection,
      items => {
        const matching = items.filter(m => matchesAll(m, q));
        if (matching.length || q.text.length) {
          done(items);
        } else {
          recent();
        }
      }
    );
  }

  // ==========================================================================================
  // State and display
  // ==========================================================================================

  /** Current search, or null. */
  let state = null; // { about3Pane, folderURI, folderName, query, text, scope, allItems, token, timer }

  const isFromSearchBar = event =>
    event.composedPath().some(node => node.localName == "global-search-bar");
  const searchBar = () => document.querySelector("global-search-bar");
  const searchInput = () => searchBar()?.shadowRoot?.querySelector("input");
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  /** Shows the all-folders results in the current tab's list. */
  function showAllResults() {
    const s = state;
    if (!s?.allItems) {
      return;
    }
    s.navigating = true;
    applyFolderQuery(s.about3Pane, null);
    s.about3Pane.restoreState({
      folderPaneVisible: true,
      syntheticView: new GlodaSyntheticView({
        collection: Gloda.explicitCollection(GlodaConstants.NOUN_MESSAGE, s.allItems),
      }),
      title: s.text,
    });
    s.navigating = false;
    // Otherwise the header keeps the folder's name and total, which would be misleading.
    const doc = s.about3Pane.document;
    doc.getElementById("threadPaneFolderName").textContent = t("searchResultsFor", s.text);
    const count = doc.getElementById("threadPaneFolderCount");
    count.removeAttribute("data-l10n-id");
    const n = s.allItems.length;
    count.textContent = t(plural.select(n) == "one" ? "searchOneMessage" : "searchMessages", String(n));
    // No folder is shown: the folder pane selection is dimmed (see ensureStyle).
    doc.body.classList.add("heron-search-all");
    renderScopeBar();
  }

  /**
   * Shows folder `uri` again in tab `about3Pane`.
   * Thunderbird ignores folder changes while a synthetic view is open, and displayFolder() does nothing if the folder is already selected: so we close the synthetic view, then reload the folder.
   */
  function reopenFolder(about3Pane, uri) {
    about3Pane.document.body.classList.remove("heron-search-all");
    if (about3Pane.gViewWrapper?.isSynthetic) {
      about3Pane.gViewWrapper.close();
      about3Pane.gViewWrapper = null;
    }
    if (about3Pane.folderTree.selectedRow?.uri == uri) {
      about3Pane.folderPane._onSelect();
    } else {
      about3Pane.displayFolder(uri);
    }
  }

  /** Returns to the original folder, filtered by the current query. */
  async function showFolder() {
    const s = state;
    s.navigating = true;
    reopenFolder(s.about3Pane, s.folderURI);
    await pause(50);
    s.navigating = false;
    applyFolderQuery(s.about3Pane, s.query);
    renderCountWhenSettled();
  }

  /** The filter applies asynchronously: read the message count again once the list stops changing. */
  async function renderCountWhenSettled() {
    let last = -1;
    for (let i = 0; i < 10; i++) {
      await pause(150);
      const rows = state?.about3Pane.gDBView?.rowCount ?? -1;
      renderScopeBar();
      if (rows == last) {
        return;
      }
      last = rows;
    }
  }

  async function setScope(scope) {
    if (!state || state.scope == scope) {
      return;
    }
    state.scope = scope;
    if (scope == "all") {
      if (state.allItems) {
        showAllResults();
      } else {
        clearTimeout(state.timer);
        queryAll(); // showAllResults() follows
      }
    } else {
      await showFolder();
    }
  }

  // --- Scope bar --------------------------------------------------------------------------

  function ensureStyle(doc) {
    if (doc.getElementById("heron-scope-style")) {
      return;
    }
    const style = doc.createElement("style");
    style.id = "heron-scope-style";
    style.textContent = `
      #heron-scope { display: flex; gap: 6px; padding: 6px 12px 8px; }
      #heron-scope button {
        all: unset; cursor: pointer; padding: 3px 12px; border-radius: 999px;
        font-size: 0.9em; color: var(--layout-color-2, GrayText);
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      #heron-scope button[aria-pressed="true"] { background: AccentColor; color: AccentColorText; }
      #heron-scope button:focus-visible { outline: 2px solid AccentColor; outline-offset: 1px; }
      body.heron-search-all #folderTree li.selected > .container {
        background: transparent !important; color: inherit !important; font-weight: normal !important;
        outline: none !important; border-color: transparent !important; box-shadow: none !important;
      }
    `;
    doc.head.appendChild(style);
  }

  function renderScopeBar() {
    const s = state;
    if (!s) {
      return;
    }
    const doc = s.about3Pane.document;
    ensureStyle(doc);
    let bar = doc.getElementById("heron-scope");
    if (!bar) {
      bar = doc.createElement("div");
      bar.id = "heron-scope";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", t("searchScope"));
      for (const scope of ["folder", "all"]) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.scope = scope;
        button.addEventListener("click", () => setScope(scope));
        bar.appendChild(button);
      }
      const header = doc.getElementById("threadPaneHeaderBar");
      header.parentNode.insertBefore(bar, header.nextSibling);
    }
    const [folderButton, allButton] = bar.children;
    const folderCount = s.scope == "folder" ? ` · ${s.about3Pane.gDBView?.rowCount ?? 0}` : "";
    folderButton.textContent = `${s.folderName}${folderCount}`;
    allButton.textContent = `${t("searchAllFolders")}${s.allItems ? ` · ${s.allItems.length}` : " · …"}`;
    folderButton.setAttribute("aria-pressed", String(s.scope == "folder"));
    allButton.setAttribute("aria-pressed", String(s.scope == "all"));
    if (panel && !panel.hidden) {
      panel.querySelector(`input[name=scope][value=${s.scope}]`).checked = true;
    }
  }

  // --- Lifecycle --------------------------------------------------------------------------

  function begin(about3Pane) {
    const folder = about3Pane.gFolder;
    if (!folder) {
      return false; // no open folder (e.g. someone else's synthetic view): leave everything alone
    }
    state = {
      about3Pane,
      folderURI: folder.URI,
      folderName: folder.localizedName ?? folder.prettyName,
      query: emptyQuery(),
      text: "",
      scope: "folder",
      allItems: null,
    };
    about3Pane.addEventListener("folderURIChanged", onFolderChanged);
    about3Pane.folderTree.addEventListener("select", onFolderSelect);
    return true;
  }

  async function end({ restoreFolder = true } = {}) {
    const s = state;
    if (!s) {
      return;
    }
    state = null;
    clearTimeout(s.timer);
    s.about3Pane.removeEventListener("folderURIChanged", onFolderChanged);
    s.about3Pane.folderTree.removeEventListener("select", onFolderSelect);
    s.about3Pane.document.getElementById("heron-scope")?.remove();
    if (restoreFolder && s.about3Pane.gViewWrapper?.isSynthetic) {
      reopenFolder(s.about3Pane, s.folderURI);
      await pause(50);
    }
    applyFolderQuery(s.about3Pane, null);
    updateFilterButton();
  }

  function clearSearchField() {
    const input = searchInput();
    if (input) {
      input.value = "";
    }
    updateFilterButton();
  }

  /** The user chose another folder during a search: end it. */
  function onFolderChanged() {
    if (!state || state.navigating) {
      return;
    }
    end({ restoreFolder: false });
    clearSearchField();
  }

  /**
   * A folder is chosen while the list shows "All folders": Thunderbird would ignore it (synthetic view). End the search and open that folder.
   */
  function onFolderSelect() {
    const s = state;
    if (!s || s.navigating || !s.about3Pane.gViewWrapper?.isSynthetic) {
      return;
    }
    const uri = s.about3Pane.folderTree.selectedRow?.uri;
    end({ restoreFolder: false });
    clearSearchField();
    if (uri) {
      reopenFolder(s.about3Pane, uri);
    }
  }

  // ==========================================================================================
  // Calendar, tasks, contacts: the same field filters the active space
  // ==========================================================================================

  /** Active space: "calendar", "tasks", "addressBookTab", or other (mail). */
  const activeSpace = () => gTabmail.currentTabInfo?.mode?.name;

  const spaceStyle = document.createElement("style");
  spaceStyle.textContent = `
    /* The calendar's and tasks' own search fields: replaced by the top one. */
    #unifinder-searchBox, #task-text-filter-field { display: none !important; }
  `;
  document.documentElement.appendChild(spaceStyle);

  // Calendar: the event list is hidden by default (the top field replaces it, and it reappears during a search).

  const UNIFINDER_DONE = "heron.unifinder.hidden";
  heronListen(gTabmail.tabContainer, "TabSelect", () => {
    if (gTabmail.currentTabInfo?.mode?.name != "calendar" || Services.prefs.getBoolPref(UNIFINDER_DONE, false)) {
      return;
    }
    setTimeout(() => {
      if (!document.getElementById("bottom-events-box")?.hidden) {
        toggleUnifinder();
      }
      Services.prefs.setBoolPref(UNIFINDER_DONE, true);
    }, 300);
  });

  /** Calendar: the event list appears only during a search, over the whole period. */
  let calendarSearch = null; // { openedList, interval }
  function searchCalendar(text) {
    const box = document.getElementById("bottom-events-box");
    const field = document.getElementById("unifinder-search-field");
    const interval = document.getElementById("event-filter-menulist");
    if (!box || !field || !interval) {
      return;
    }
    if (text && !calendarSearch) {
      calendarSearch = { openedList: box.hidden, interval: interval.value };
      if (box.hidden) {
        toggleUnifinder();
      }
      interval.value = "all";
      refreshUnifinderFilterInterval();
    }
    field.value = text;
    field.dispatchEvent(new Event("input"));
    if (!text && calendarSearch) {
      interval.value = calendarSearch.interval;
      refreshUnifinderFilterInterval();
      if (calendarSearch.openedList && !box.hidden) {
        toggleUnifinder();
      }
      calendarSearch = null;
    }
  }

  function searchTasks(text) {
    const field = document.getElementById("task-text-filter-field");
    if (field) {
      field.value = text;
      taskViewUpdate();
    }
  }

  /** Contacts: the address book filters its list on its field's "autocomplete" event. */
  function searchContacts(text) {
    const doc = gTabmail.currentTabInfo?.browser?.contentDocument;
    const box = doc?.getElementById("searchInput");
    if (!box) {
      return;
    }
    if (!doc.getElementById("heron-search-style")) {
      const css = doc.createElement("style");
      css.id = "heron-search-style";
      css.textContent = "#searchInput { display: none !important; }";
      doc.head.appendChild(css);
    }
    const input = box.shadowRoot?.querySelector("input");
    if (input) {
      input.value = text;
    }
    box.dispatchEvent(new CustomEvent("autocomplete", { detail: text }));
  }

  /** The top field was cleared when leaving a space: restore each space's full view. */
  function clearOtherSpaces() {
    searchCalendar("");
    searchTasks("");
  }

  /** The field text changed (keystroke or filter panel): run the search again. */
  function onQueryText(text) {
    switch (activeSpace()) {
      case "calendar":
        searchCalendar(text.trim());
        return;
      case "tasks":
        searchTasks(text.trim());
        return;
      case "addressBookTab":
        searchContacts(text.trim());
        return;
    }
    const about3Pane = gTabmail.currentAbout3Pane;
    const query = parseQuery(text);
    updateFilterButton(query);
    if (isEmptyQuery(query)) {
      end();
      return;
    }
    if (!about3Pane) {
      return;
    }
    if (state && state.about3Pane != about3Pane) {
      end();
    }
    if (!state && !begin(about3Pane)) {
      return;
    }
    state.text = text.trim();
    state.query = query;
    state.allItems = null;
    clearTimeout(state.timer);
    // "dossier:" only makes sense across all folders.
    if (query.folder && state.scope == "folder") {
      setScope("all");
      return;
    }
    if (state.scope == "folder") {
      applyFolderQuery(about3Pane, query);
      renderCountWhenSettled();
    }
    renderScopeBar();
    state.timer = setTimeout(queryAll, DEBOUNCE_MS);
  }

  // ==========================================================================================
  // Filter button (inside the field) and panel
  // ==========================================================================================

  let filterButton = null;
  let panel = null;
  let filterStyle = null;
  let tipsButton = null;
  let tips = null;
  let tipsStyle = null;
  let panelStyle = null;

  function updateFilterButton(query = parseQuery(searchInput()?.value ?? "")) {
    const active = Boolean(hasFilters(query)) || Boolean(panel && !panel.hidden);
    filterButton?.setAttribute("aria-pressed", String(active));
  }

  function installFilterButton() {
    const bar = searchBar();
    const form = bar?.shadowRoot?.querySelector("form");
    if (!form) {
      return false;
    }
    if (form.querySelector("#heron-filters")) {
      return true;
    }
    const style = document.createElement("style");
    // In this field, the text spans the full width and the buttons sit on top of it, on the right: reserve room for one more button and place it left of the magnifier.
    style.textContent = `
      :host { --search-buttons-padding: 84px !important; }
      #heron-tips-button {
        all: unset; box-sizing: border-box; cursor: pointer;
        position: absolute; z-index: 1; inset-block: 0; inset-inline-end: 56px; margin-block: auto;
        width: 26px; height: 22px; border-radius: 6px;
        background: url("chrome://messenger/skin/icons/new/compact/info.svg") center / 16px no-repeat;
        -moz-context-properties: fill, stroke; fill: transparent; stroke: currentColor; opacity: 0.65; /* outlined, like its neighbors */
      }
      #heron-tips-button:hover, #heron-tips-button[aria-expanded="true"] { opacity: 1; background-color: color-mix(in srgb, currentColor 10%, transparent); }
      #heron-tips-button[hidden] { display: none; }
      #heron-filters {
        all: unset; box-sizing: border-box; cursor: pointer;
        position: absolute; z-index: 1; inset-block: 0; inset-inline-end: 28px; margin-block: auto;
        width: 26px; height: 22px; border-radius: 6px;
        background: var(--icon-filter, url("chrome://messenger/skin/icons/new/compact/filter.svg")) center / 16px no-repeat;
        -moz-context-properties: fill, stroke; fill: currentColor; stroke: currentColor; opacity: 0.65;
      }
      #heron-filters:hover { opacity: 1; background-color: color-mix(in srgb, currentColor 10%, transparent); }
      #heron-filters[aria-pressed="true"] { opacity: 1; color: AccentColor; }
      #heron-filters[hidden] { display: none; }
    `;
    bar.shadowRoot.appendChild(style);
    filterStyle = style;
    filterButton = document.createElement("button");
    filterButton.type = "button";
    filterButton.id = "heron-filters";
    filterButton.title = t("searchFilters");
    filterButton.setAttribute("aria-label", t("searchFilters"));
    filterButton.setAttribute("aria-haspopup", "dialog");
    filterButton.addEventListener("click", event => {
      event.preventDefault();
      togglePanel();
    });
    form.insertBefore(filterButton, form.querySelector("#search-button"));

    tipsButton = document.createElement("button");
    tipsButton.type = "button";
    tipsButton.id = "heron-tips-button";
    tipsButton.title = t("tipsButton");
    tipsButton.setAttribute("aria-label", t("tipsButton"));
    tipsButton.setAttribute("aria-haspopup", "dialog");
    tipsButton.setAttribute("aria-expanded", "false");
    tipsButton.addEventListener("click", event => {
      event.preventDefault();
      toggleTips();
    });
    form.insertBefore(tipsButton, filterButton);
    return true;
  }

  const PANEL_STYLE = `
    #heron-search-panel {
      position: fixed; z-index: 10; box-sizing: border-box; padding: 14px 16px;
      width: 520px; max-width: calc(100vw - 24px); border-radius: 12px;
      background: var(--layout-background-0, Canvas); color: var(--layout-color-1, CanvasText);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.06);
      font: menu; font-size: 0.95em;
    }
    #heron-search-panel[hidden] { display: none; }
    #heron-search-panel .heron-grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; align-items: center; }
    #heron-search-panel label { color: var(--layout-color-2, GrayText); }
    #heron-search-panel input[type=text], #heron-search-panel input[type=date], #heron-search-panel select {
      box-sizing: border-box; width: 100%; padding: 4px 8px; border-radius: 6px; font: inherit;
      border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit;
    }
    #heron-search-panel select {
      appearance: none; padding-inline-end: 26px;
      background: url("chrome://messenger/skin/icons/new/compact/nav-down.svg") no-repeat right 8px center / 12px;
      -moz-context-properties: fill; fill: currentColor;
    }
    #heron-search-panel .heron-dates { display: flex; gap: 8px; align-items: center; }
    #heron-search-panel .heron-dates span { white-space: nowrap; color: var(--layout-color-2, GrayText); }
    #heron-search-panel .heron-checks { display: flex; gap: 16px; margin-top: 12px; }
    #heron-search-panel .heron-checks label, #heron-search-panel .heron-scope label {
      color: inherit; display: flex; gap: 6px; align-items: center;
    }
    #heron-search-panel .heron-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
    #heron-search-panel .heron-scope { display: flex; gap: 14px; }
    #heron-search-panel .heron-buttons { display: flex; gap: 8px; }
    #heron-search-panel button {
      all: unset; cursor: pointer; padding: 4px 14px; border-radius: 8px;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    #heron-search-panel button.heron-primary { background: AccentColor; color: AccentColorText; }
  `;

  const html = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key == "className" || key == "textContent" || key == "htmlFor" || key in el) {
        el[key] = value;
      } else {
        el.setAttribute(key, value);
      }
    }
    el.append(...children);
    return el;
  };

  function buildPanel() {
    panelStyle = document.documentElement.appendChild(html("style", { textContent: PANEL_STYLE }));

    const grid = html("div", { className: "heron-grid" });
    const textField = (name, label, placeholder) =>
      grid.append(
        html("label", { textContent: label, htmlFor: `heron-f-${name}` }),
        html("input", { type: "text", id: `heron-f-${name}`, name, placeholder })
      );
    textField("from", t("searchFrom"), t("searchNameOrAddress"));
    textField("to", t("searchTo"), t("searchNameOrAddress"));
    textField("subject", t("searchSubject"), "");
    textField("text", t("searchContains"), t("searchWords"));
    grid.append(
      html("label", { textContent: t("searchDate") }),
      html("div", { className: "heron-dates" }, [
        html("span", { textContent: t("searchSince") }),
        html("input", { type: "date", name: "after", "aria-label": t("searchSince") }),
        html("span", { textContent: t("searchBefore") }),
        html("input", { type: "date", name: "before", "aria-label": t("searchBefore") }),
      ])
    );
    grid.append(
      html("label", { textContent: t("searchTag"), htmlFor: "heron-f-tag" }),
      html("select", { id: "heron-f-tag", name: "tag" })
    );
    textField("folder", t("searchFolder"), t("searchAnyFolder"));

    const checks = html(
      "div",
      { className: "heron-checks" },
      [["attachment", t("searchAttachments")], ["unread", t("searchUnread")], ["flagged", t("searchFlagged")]].map(([name, text]) =>
        html("label", {}, [html("input", { type: "checkbox", name }), text])
      )
    );

    const clear = html("button", { type: "button", textContent: t("searchClear") });
    const go = html("button", { type: "button", className: "heron-primary", textContent: t("searchGo") });
    const actions = html("div", { className: "heron-actions" }, [
      html(
        "div",
        { className: "heron-scope", role: "radiogroup", "aria-label": t("searchWhere") },
        [["folder", t("searchThisFolder")], ["all", t("searchAllFolders")]].map(([value, text]) =>
          html("label", {}, [html("input", { type: "radio", name: "scope", value }), text])
        )
      ),
      html("div", { className: "heron-buttons" }, [clear, go]),
    ]);

    panel = html("div", { id: "heron-search-panel", role: "dialog", "aria-label": t("searchAdvanced") }, [
      grid,
      checks,
      actions,
    ]);
    panel.hidden = true;
    document.documentElement.appendChild(panel);

    clear.addEventListener("click", () => {
      writeField("");
      fillPanel(emptyQuery());
    });
    go.addEventListener("click", () => {
      const scope = panel.querySelector("input[name=scope]:checked")?.value ?? "folder";
      hidePanel();
      if (state) {
        setScope(scope);
      }
    });
    // Every panel change rewrites the top field (and runs the search again).
    panel.addEventListener("input", event => {
      if (event.target.name != "scope") {
        writeField(formatQuery(readPanel()));
      }
    });
    panel.addEventListener("change", event => {
      if (event.target.name == "scope" && state) {
        setScope(event.target.value);
      }
    });
    panel.addEventListener("keydown", event => {
      if (event.key == "Escape") {
        event.stopPropagation();
        hidePanel();
        searchInput()?.focus();
      } else if (event.key == "Enter") {
        go.click();
      }
    });
  }

  /** Panel fields → query. Free text is read from "Contains". */
  function readPanel() {
    const q = emptyQuery();
    const value = name => panel.querySelector(`[name=${name}]`).value.trim();
    const words = name => (value(name) ? [value(name)] : []);
    q.from = words("from");
    q.to = words("to");
    q.subject = words("subject");
    q.text = value("text") ? parseQuery(value("text")).text : [];
    q.after = parseDay(value("after"));
    q.before = parseDay(value("before"));
    q.folder = value("folder") || null;
    q.tag = words("tag");
    for (const name of ["attachment", "unread", "flagged"]) {
      q[name] = panel.querySelector(`[name=${name}]`).checked;
    }
    return q;
  }

  /** Query → panel fields. */
  function fillPanel(q) {
    const set = (name, v) => (panel.querySelector(`[name=${name}]`).value = v);
    set("from", q.from.join(" "));
    set("to", q.to.join(" "));
    set("subject", q.subject.join(" "));
    set("text", q.text.map(quote).join(" "));
    set("after", q.after ? formatDay(q.after) : "");
    set("before", q.before ? formatDay(q.before) : "");
    set("folder", q.folder ?? "");
    // Tags are listed fresh each time (they can be added or renamed in Thunderbird).
    const select = panel.querySelector("[name=tag]");
    select.replaceChildren(
      html("option", { value: "", textContent: t("searchAnyTag") }),
      ...allTags().map(tag => html("option", { value: tag.name, textContent: tag.name }))
    );
    // The typed value selects the tag of the same name (case and accents ignored); a partial name gets its own entry.
    const typed = q.tag[0] ?? "";
    const same = [...select.options].find(o => o.value && norm(o.value) == norm(typed));
    if (typed && !same) {
      select.append(html("option", { value: typed, textContent: typed }));
    }
    select.value = same ? same.value : typed;
    for (const name of ["attachment", "unread", "flagged"]) {
      panel.querySelector(`[name=${name}]`).checked = q[name];
    }
    panel.querySelector(`input[name=scope][value=${state?.scope ?? "folder"}]`).checked = true;
  }

  /** Writes `text` into the top field, like typing (the search follows). */
  function writeField(text) {
    const input = searchInput();
    if (!input) {
      return;
    }
    input.value = text;
    onQueryText(text);
    updateSuggestions(text);
  }

  function showPanel() {
    hideTips();
    if (!panel) {
      buildPanel();
    }
    fillPanel(parseQuery(searchInput()?.value ?? ""));
    panel.hidden = false;
    positionPanel();
    updateFilterButton();
    panel.querySelector("input")?.focus();
  }

  /** Below the field, aligned with its right edge (under the filter button). */
  function positionPanel() {
    const rect = (searchInput() ?? searchBar()).getBoundingClientRect();
    panel.style.top = `${rect.bottom + 6}px`;
    panel.style.left = `${Math.max(12, rect.right - panel.offsetWidth)}px`;
  }
  heronListen(window, "resize", () => panel && !panel.hidden && positionPanel());

  function hidePanel() {
    if (panel) {
      panel.hidden = true;
    }
    updateFilterButton();
  }

  const togglePanel = () => (panel && !panel.hidden ? hidePanel() : showPanel());

  // --- Quick search tips (the (i) button) ----------------------------------------------------
  // Examples in the interface language; a click adds the keyword to the field, ready to type the rest.

  function buildTips() {
    const k = KEYWORDS;
    const year = new Date().getFullYear();
    const rows = [
      [`${k.from}:${t("tipExampleName")}`, t("tipFrom"), `${k.from}:`],
      [`${k.to}:${t("tipExampleName")}`, t("tipTo"), `${k.to}:`],
      [`${k.subject}:${t("tipExampleWord")}`, t("tipSubject"), `${k.subject}:`],
      [`"${t("tipExamplePhrase")}"`, t("tipPhrase"), '"'],
      [k.unread, t("tipUnread"), k.unread],
      [k.flagged, t("tipFlagged"), k.flagged],
      [k.attachment, t("tipAttachment"), k.attachment],
      [`${k.tag}:${t("tipExampleTag")}`, t("tipTag"), `${k.tag}:`],
      [`${k.after}:${year}-01-01 ${k.before}:${year}-02-01`, t("tipDates"), `${k.after}:`],
      [`${k.folder}:${t("tipExampleFolder")}`, t("tipFolder"), `${k.folder}:`],
    ];
    tipsStyle = document.documentElement.appendChild(html("style", { textContent: `
      #heron-search-tips {
        position: fixed; z-index: 10; box-sizing: border-box; padding: 12px 14px; width: 420px; max-width: calc(100vw - 24px);
        border-radius: 12px; background: var(--layout-background-0, Canvas); color: var(--layout-color-1, CanvasText);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.06); font: menu; font-size: 0.95em;
      }
      #heron-search-tips[hidden] { display: none; }
      #heron-search-tips h2 { margin: 0 0 8px; font-size: 1em; font-weight: 600; }
      #heron-search-tips ul { list-style: none; margin: 0; padding: 0; }
      #heron-search-tips li {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: baseline;
        padding: 4px 8px; margin-inline: -8px; border-radius: 6px; cursor: pointer;
      }
      #heron-search-tips li:hover { background: color-mix(in srgb, AccentColor 14%, transparent); }
      #heron-search-tips code { font: 0.95em ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
      #heron-search-tips li span { color: var(--layout-color-2, GrayText); }
      #heron-search-tips p { margin: 10px 0 0; color: var(--layout-color-2, GrayText); }
    ` }));
    tips = html("div", { id: "heron-search-tips", role: "dialog", "aria-label": t("tipsTitle") }, [
      html("h2", { textContent: t("tipsTitle") }),
      html("ul", {}, rows.map(([example, text, insert]) => {
        const li = html("li", { title: text }, [html("code", { textContent: example }), html("span", { textContent: text })]);
        li.addEventListener("click", () => insertKeyword(insert));
        return li;
      })),
      html("p", { textContent: t("tipsFooter", `${k.from}:${t("tipExampleName")} ${k.unread}`) }),
    ]);
    tips.hidden = true;
    document.documentElement.appendChild(tips);
  }

  /** Adds `keyword` at the end of the field and puts the cursor after it. */
  function insertKeyword(keyword) {
    const input = searchInput();
    if (!input) {
      return;
    }
    const current = input.value.trimEnd();
    const text = current ? `${current} ${keyword}` : keyword;
    hideTips();
    writeField(text);
    input.focus();
    input.setSelectionRange(text.length, text.length);
  }

  function showTips() {
    if (!tips) {
      buildTips();
    }
    hidePanel();
    tips.hidden = false;
    const rect = (searchInput() ?? searchBar()).getBoundingClientRect();
    tips.style.top = `${rect.bottom + 6}px`;
    tips.style.left = `${Math.max(12, rect.right - tips.offsetWidth)}px`;
    tipsButton?.setAttribute("aria-expanded", "true");
  }

  function hideTips() {
    if (tips) {
      tips.hidden = true;
    }
    tipsButton?.setAttribute("aria-expanded", "false");
  }

  const toggleTips = () => (tips && !tips.hidden ? hideTips() : showTips());

  // A click elsewhere, or Escape, closes the tips.
  heronListen(document, "mousedown", event => {
    if (tips && !tips.hidden) {
      const path = event.composedPath();
      if (!path.includes(tips) && !path.includes(tipsButton)) {
        hideTips();
      }
    }
  }, true);
  heronListen(document, "keydown", event => {
    if (event.key == "Escape" && tips && !tips.hidden) {
      event.stopPropagation();
      hideTips();
    }
  }, true);

  // A click elsewhere closes the panel.
  heronListen(
    document,
    "mousedown",
    event => {
      if (!panel || panel.hidden) {
        return;
      }
      const path = event.composedPath();
      if (!path.includes(panel) && !path.includes(filterButton)) {
        hidePanel();
      }
    },
    true
  );

  // Switching space clears the field: a search only applies to the space where it was made.
  heronListen(gTabmail.tabContainer, "TabSelect", () => {
    // Advanced filters only apply to mail.
    if (filterButton) {
      filterButton.hidden = ["calendar", "tasks", "addressBookTab"].includes(activeSpace());
    }
    if (tipsButton) {
      tipsButton.hidden = ["calendar", "tasks", "addressBookTab"].includes(activeSpace());
      hideTips();
    }
    const input = searchInput();
    if (input?.value) {
      input.value = "";
      updateFilterButton();
      end();
      clearOtherSpaces();
    }
  });

  // The field may be created after this script: retry until it exists.
  (function waitForSearchBar(tries = 0) {
    if (!heronStopped && !installFilterButton() && tries < 50) {
      setTimeout(() => waitForSearchBar(tries + 1), 200);
    }
  })();

  // ==========================================================================================
  // Suggestions below the field (instead of Thunderbird's dropdown)
  // ==========================================================================================

  let suggest = null; // list element
  let suggestStyle = null;
  let suggestions = []; // [{ label, apply() }]
  let highlighted = -1;

  /** Address book contacts, read once then cached (name and address without accents). */
  let contactIndex = null;
  function contacts() {
    if (!contactIndex) {
      contactIndex = [];
      for (const directory of MailServices.ab.directories) {
        try {
          for (const card of directory.childCards) {
            if (!card.isMailList && card.primaryEmail) {
              const name = card.displayName || card.primaryEmail;
              contactIndex.push({ name, email: card.primaryEmail, key: norm(`${name} ${card.primaryEmail}`) });
            }
          }
        } catch {
          // A remote address book may refuse reading: skip it.
        }
      }
    }
    return contactIndex;
  }
  // The index is rebuilt on next use whenever a contact changes.
  const contactsObserver = { observe: () => (contactIndex = null) };
  const CONTACT_TOPICS = ["addrbook-contact-created", "addrbook-contact-updated", "addrbook-contact-deleted"];
  for (const topic of CONTACT_TOPICS) {
    Services.obs.addObserver(contactsObserver, topic);
  }
  heronOnStop(() => CONTACT_TOPICS.forEach(topic => Services.obs.removeObserver(contactsObserver, topic)));

  /** The word being typed (last word, no keyword), or null. */
  function currentWord(text) {
    const m = /(?:^|\s)([^\s:"]{2,})$/.exec(text);
    return m && !FLAG_WORDS[norm(m[1])] ? { word: m[1], start: text.length - m[1].length } : null;
  }

  function hideSuggestions() {
    if (suggest) {
      suggest.hidden = true;
    }
    suggestions = [];
    highlighted = -1;
  }

  function updateSuggestions(text) {
    const space = activeSpace();
    const current = currentWord(text);
    if (!current || ["calendar", "tasks", "addressBookTab"].includes(space)) {
      hideSuggestions();
      return;
    }
    const k = KEYWORDS;
    const replaceWith = token => () => writeField(`${text.slice(0, current.start)}${token} `);
    suggestions = [
      { label: `${t("searchFrom")}${t("labelSeparator")}${current.word}`, apply: replaceWith(`${k.from}:${quote(current.word)}`) },
      { label: `${t("searchTo")}${t("labelSeparator")}${current.word}`, apply: replaceWith(`${k.to}:${quote(current.word)}`) },
      { label: `${t("searchSubject")}${t("labelSeparator")}${current.word}`, apply: replaceWith(`${k.subject}:${quote(current.word)}`) },
    ];
    const needle = norm(current.word);
    for (const contact of contacts().filter(c => c.key.includes(needle)).slice(0, 4)) {
      suggestions.push({
        label: `${t("searchFrom")}${t("labelSeparator")}${contact.name}`,
        detail: contact.email,
        apply: replaceWith(`${k.from}:${quote(contact.email)}`),
      });
    }
    renderSuggestions();
  }

  function renderSuggestions() {
    if (!suggest) {
      const css = document.createElement("style");
      css.textContent = `
        #heron-suggest {
          position: fixed; z-index: 11; box-sizing: border-box; padding: 4px; margin: 0; list-style: none;
          border-radius: 10px; background: var(--layout-background-0, Canvas); color: var(--layout-color-1, CanvasText);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.06); font: menu;
        }
        #heron-suggest[hidden] { display: none; }
        #heron-suggest li { display: flex; gap: 10px; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
        #heron-suggest li[aria-selected="true"], #heron-suggest li:hover { background: color-mix(in srgb, AccentColor 18%, transparent); }
        #heron-suggest .heron-detail { color: var(--layout-color-2, GrayText); }
      `;
      document.documentElement.appendChild(css);
      suggestStyle = css;
      suggest = document.createElement("ul");
      suggest.id = "heron-suggest";
      suggest.setAttribute("role", "listbox");
      // mousedown: before the field loses focus.
      suggest.addEventListener("mousedown", event => {
        const item = event.target.closest("li");
        if (item) {
          event.preventDefault();
          suggestions[Number(item.dataset.index)]?.apply();
          searchInput()?.focus();
        }
      });
      document.documentElement.appendChild(suggest);
    }
    suggest.replaceChildren(
      ...suggestions.map((s, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.dataset.index = i;
        li.setAttribute("aria-selected", String(i == highlighted));
        const label = document.createElement("span");
        label.textContent = s.label;
        li.append(label);
        if (s.detail) {
          const detail = document.createElement("span");
          detail.className = "heron-detail";
          detail.textContent = s.detail;
          li.append(detail);
        }
        return li;
      })
    );
    const rect = (searchInput() ?? searchBar()).getBoundingClientRect();
    suggest.style.top = `${rect.bottom + 4}px`;
    suggest.style.left = `${rect.left}px`;
    suggest.style.width = `${Math.min(rect.width, 420)}px`;
    suggest.hidden = !suggestions.length || Boolean(panel && !panel.hidden);
  }

  // Thunderbird's dropdown (suggestions from its index, which led to a results tab) is no longer triggered: our suggestions replace it.
  heronListen(
    document,
    "autocomplete",
    event => {
      if (isFromSearchBar(event)) {
        event.stopImmediatePropagation();
      }
    },
    true
  );

  // Arrows and Enter in the suggestions.
  heronListen(
    document,
    "keydown",
    event => {
      if (!isFromSearchBar(event) || !suggest || suggest.hidden || !suggestions.length) {
        return;
      }
      if (event.key == "ArrowDown" || event.key == "ArrowUp") {
        event.preventDefault();
        const step = event.key == "ArrowDown" ? 1 : -1;
        // -1 = nothing highlighted; cycle through -1, 0, 1, ... n-1.
        const n = suggestions.length + 1;
        highlighted = ((highlighted + 1 + step + n) % n) - 1;
        renderSuggestions();
      } else if (event.key == "Enter" && highlighted >= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const choice = suggestions[highlighted];
        hideSuggestions();
        choice.apply();
      } else if (event.key == "Escape") {
        // First Escape: only closes the suggestions.
        event.preventDefault();
        event.stopImmediatePropagation();
        hideSuggestions();
      }
    },
    true
  );
  heronListen(
    document,
    "blur",
    event => isFromSearchBar(event) && setTimeout(hideSuggestions, 150),
    true
  );

  // ==========================================================================================
  // Top field events
  // ==========================================================================================

  heronListen(
    document,
    "input",
    event => {
      if (!isFromSearchBar(event)) {
        return;
      }
      const text = event.composedPath()[0].value;
      onQueryText(text);
      updateSuggestions(text);
      if (panel && !panel.hidden) {
        fillPanel(parseQuery(text));
      }
    },
    true
  );

  // Enter: instead of opening a results tab, switch the list to "All folders".
  heronListen(
    document,
    "search",
    event => {
      if (!isFromSearchBar(event)) {
        return;
      }
      event.stopImmediatePropagation();
      event.preventDefault(); // keep the text in the field
      hidePanel();
      hideSuggestions();
      if (state && !["calendar", "tasks", "addressBookTab"].includes(activeSpace())) {
        setScope("all");
      }
    },
    true
  );

  // Escape in the field: end the search.
  heronListen(
    document,
    "keydown",
    event => {
      if (event.key == "Escape" && isFromSearchBar(event) && searchInput()?.value) {
        clearSearchField();
        hidePanel();
        end();
        clearOtherSpaces();
        if (activeSpace() == "addressBookTab") {
          searchContacts("");
        }
      }
    },
    true
  );

  // ==========================================================================================
  // Shutdown: Thunderbird's search comes back as is
  // ==========================================================================================

  heronOnStop(() => {
    hidePanel();
    hideSuggestions();
    // Search in progress: the list returns to the folder, calendar and contacts to their full view.
    if (searchInput()?.value) {
      clearSearchField();
      clearOtherSpaces();
    }
    if (calendarSearch) {
      searchCalendar("");
    }
    end();
    for (const node of [spaceStyle, filterStyle, filterButton, tipsButton, tipsStyle, tips, panelStyle, panel, suggestStyle, suggest]) {
      node?.remove();
    }
    for (const tab of gTabmail.tabInfo) {
      const doc = tab.mode?.name == "mail3PaneTab" ? tab.chromeBrowser?.contentDocument : tab.browser?.contentDocument;
      doc?.getElementById("heron-scope-style")?.remove();
      doc?.getElementById("heron-search-style")?.remove();
    }
  });
})();
