/* heron: conversation view (module "conversation").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the about:3pane window. Replaces the display of a selected thread (Thunderbird's summary, or its experimental conversation view) with a stack of cards:
 * - clicking a card's header expands it; clicking again collapses it;
 * - several messages can be open at once;
 * - the newest is at the bottom (setting: at the top); on open, the newest and the unread ones are expanded;
 * - thread messages stored elsewhere (Sent...) are added through Thunderbird's index; if the index has not seen the thread yet, the folder's messages are still shown;
 * - each open message is a real Thunderbird reader (about:message): Reply, Forward, attachments and blocked remote content work as usual.
 */
(() => {
  if (document.documentElement.dataset.heronConversation) {
    return;
  }
  document.documentElement.dataset.heronConversation = "1";

  const { Gloda } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaPublic.sys.mjs");
  const { MsgHdrToMimeMessage } = ChromeUtils.importESModule("resource:///modules/gloda/MimeMessage.sys.mjs");
  const { mimeMsgToContentSnippetAndMeta } = ChromeUtils.importESModule(
    "resource:///modules/gloda/GlodaContent.sys.mjs"
  );
  const { makeFriendlyDateAgo } = ChromeUtils.importESModule("resource:///modules/TemplateUtils.sys.mjs");
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);
  const config = () => ({ conversationOrder: "oldest-first", ...heronConfig });

  /** Maximum number of messages expanded automatically (each open reader costs memory). */
  const MAX_AUTO_OPEN = 4;

  const pane = messagePane;
  const view = document.createElement("div");
  view.id = "heron-conversation";
  view.hidden = true;
  view.setAttribute("role", "region");
  pane.append(view);

  // Chat layout (on by default, can be turned off in the options): applied right away when the setting changes.
  const applyLayout = () => view.classList.toggle("heron-chat", config().chatLayout !== false);
  applyLayout();
  globalThis.heronConfigChanged = applyLayout;

  const style = document.createElement("style");
  style.textContent = `
    #heron-conversation {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; box-sizing: border-box;
      padding: 16px 18px 28px; background: var(--layout-background-1, Canvas);
    }
    #heron-conversation[hidden] { display: none; }
    #heron-conversation > header { display: flex; align-items: flex-end; gap: 12px; margin: 4px 4px 16px; }
    #heron-conversation > header h1 { flex: 1; margin: 0; font-size: 1.35rem; font-weight: 600; line-height: 1.25; }
    #heron-conversation > header .heron-meta { color: var(--layout-color-2, GrayText); white-space: nowrap; font-size: 0.9em; }
    #heron-conversation > header button {
      all: unset; cursor: pointer; white-space: nowrap; font-size: 0.9em; padding: 3px 10px; border-radius: 999px;
      color: var(--layout-color-2, GrayText); background: color-mix(in srgb, currentColor 8%, transparent);
    }
    #heron-conversation > header button:hover { color: inherit; }
    .heron-msg {
      margin-block-end: 8px; border-radius: 12px; overflow: clip;
      background: var(--layout-background-0, Canvas);
      box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 8%, transparent);
    }
    .heron-msg > .heron-head {
      display: grid; grid-template-columns: auto 1fr auto; column-gap: 10px; align-items: center;
      padding: 10px 14px; cursor: pointer; user-select: none;
    }
    .heron-msg > .heron-head:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
    .heron-msg > .heron-head:focus-visible { outline: 2px solid AccentColor; outline-offset: -2px; }
    .heron-avatar {
      grid-row: span 2; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
      color: #fff; font-weight: 600; font-size: 0.85em;
    }
    .heron-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .heron-date { color: var(--layout-color-2, GrayText); font-size: 0.9em; white-space: nowrap; }
    .heron-snippet {
      grid-column: 2 / 4; color: var(--layout-color-2, GrayText); font-size: 0.92em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .heron-msg.heron-unread .heron-name::after {
      content: ""; display: inline-block; width: 7px; height: 7px; margin-inline-start: 6px;
      border-radius: 50%; background: AccentColor; vertical-align: middle;
    }
    .heron-msg[aria-expanded="true"] .heron-snippet { display: none; }
    .heron-msg[aria-expanded="true"] .heron-avatar { grid-row: auto; }
    .heron-msg > .heron-body { display: none; border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
    .heron-msg[aria-expanded="true"] > .heron-body { display: block; }
    .heron-msg > .heron-body > browser { display: block; width: 100%; height: 240px; }

    /* Chat layout: other people on the left, your own messages on the right, each leaving a margin on the other side. */
    .heron-chat .heron-msg {
      width: calc(100% - clamp(12px, 7%, 60px)); margin-inline-end: auto;
      border-start-start-radius: 4px;
    }
    .heron-chat .heron-msg.heron-mine { margin-inline: auto 0; border-start-start-radius: 12px; border-start-end-radius: 4px; }
    .heron-chat .heron-mine .heron-avatar { display: none; }
    .heron-chat .heron-mine > .heron-head { grid-template-columns: 1fr auto; }
    .heron-chat .heron-mine .heron-snippet { grid-column: 1 / 3; }
    /* Your messages: a muted blue (accent color mixed with the background), with the usual text color. */
    .heron-chat .heron-msg.heron-mine {
      --heron-mine-background: light-dark(
        color-mix(in srgb, AccentColor 24%, var(--layout-background-0, Canvas)),
        color-mix(in srgb, AccentColor 45%, var(--layout-background-0, Canvas))
      );
    }
    .heron-chat .heron-msg.heron-mine[aria-expanded="false"] { background: var(--heron-mine-background); box-shadow: none; }
    .heron-chat .heron-msg.heron-mine[aria-expanded="false"] :is(.heron-date, .heron-snippet) { color: inherit; opacity: 0.75; }
    .heron-chat .heron-msg.heron-mine[aria-expanded="false"] > .heron-head:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
    /* Expanded: the same blue for the card header and its outline; the email inside keeps its own colors. */
    .heron-chat .heron-msg.heron-mine[aria-expanded="true"] {
      background: var(--heron-mine-background);
      box-shadow: 0 0 0 1px var(--heron-mine-background);
    }
  `;
  document.head.appendChild(style);

  // --- Thread messages ----------------------------------------------------------------------

  /** Stable color per sender. */
  function colorFor(text) {
    let hash = 0;
    for (const char of text) {
      hash = (hash * 31 + char.codePointAt(0)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 45% 52%)`;
  }

  /** Your own addresses (every identity of every account), to put your messages on the right. */
  const myAddresses = () =>
    new Set(MailServices.accounts.allIdentities.map(identity => identity.email?.toLowerCase()).filter(Boolean));

  function author(hdr) {
    const [address] = MailServices.headerParser.parseDecodedHeader(hdr.mime2DecodedAuthor);
    return { name: address?.name || address?.email || hdr.mime2DecodedAuthor, email: address?.email ?? "" };
  }

  const byDate = (a, b) => a.date - b.date;
  const uniqueById = hdrs => {
    const seen = new Map();
    for (const hdr of hdrs) {
      if (hdr && !seen.has(hdr.messageId)) {
        seen.set(hdr.messageId, hdr);
      }
    }
    return [...seen.values()];
  };

  /** Completes the thread with messages stored elsewhere (Sent...), using Thunderbird's index. */
  function withIndexedMessages(root, onMessages) {
    try {
      Gloda.getMessageCollectionForHeader(root, {
        onItemsAdded() {},
        onItemsModified() {},
        onItemsRemoved() {},
        onQueryCompleted(collection) {
          const conversation = collection.items[0]?.conversation;
          if (!conversation) {
            return;
          }
          conversation.getMessagesCollection({
            onItemsAdded() {},
            onItemsModified() {},
            onItemsRemoved() {},
            onQueryCompleted: messages => onMessages(messages.items.map(m => m.folderMessage).filter(Boolean)),
          });
        },
      });
    } catch (e) {
      console.error("heron: conversation (index)", e);
    }
  }

  /** Where quoted history (or the signature) starts in a preview: "On ... wrote:" at the start of a line, Outlook's "From: ... Sent:", an "Original Message" line, or the "-- " signature delimiter. */
  const QUOTE_STARTS = [
    /(?:^|\n)[ \t]*(?:Le|On|Am|El|Il)\s[^\n]{0,160}?(?:a écrit|wrote|schrieb|escribió|ha scritto)[\s ]*:/,
    /(?:^|\n)[ \t]*(?:De|From|Von|Da)[\s ]*:[^]{0,200}?(?:Envoy[ée]|Sent|Date|Enviado|Fecha|Gesendet|Inviato)[\s ]*:/,
    /-{2,}[\s ]*(?:Original Message|Message d.origine|Forwarded message|Message transf[ée]r[ée]|Mensaje original|Mensaje reenviado)/i,
    /\n-- ?\n/,
  ];

  /** What the person actually wrote: the preview cut where the quoted history or the signature begins. */
  const ownText = text => {
    const cuts = QUOTE_STARTS.map(re => re.exec(text)?.index).filter(i => i > 0);
    return (cuts.length ? text.slice(0, Math.min(...cuts)) : text).trim();
  };

  function fillSnippet(hdr, element) {
    try {
      MsgHdrToMimeMessage(
        hdr,
        null,
        (header, mime) => {
          if (mime) {
            const [text] = mimeMsgToContentSnippetAndMeta(mime, header.folder, 400);
            element.textContent = ownText(text).slice(0, 140);
          }
        },
        false,
        { saneBodySize: true }
      );
    } catch {
      // Message not available offline: no snippet.
    }
  }

  // --- Message reader (about:message) -------------------------------------------------------

  /** Actual height of a message shown in `browser`: header, bars, body and attachments. */
  function fitHeight(browser) {
    const doc = browser.contentDocument;
    const box = doc?.getElementById("messagepanebox");
    const content = doc?.getElementById("messagepane")?.contentDocument;
    if (!box || !content?.body) {
      return;
    }
    let height = 0;
    for (const child of box.children) {
      if (child.id != "messagepane") {
        height += child.getBoundingClientRect().height;
      }
    }
    const style = content.defaultView.getComputedStyle(content.body);
    const body =
      content.body.scrollHeight + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
    browser.style.height = `${Math.ceil(height + body + 8)}px`;
  }

  function openReader(card, hdr) {
    const body = card.querySelector(".heron-body");
    if (body.querySelector("browser")) {
      return;
    }
    const browser = document.createXULElement("browser");
    browser.setAttribute("src", "about:message");
    browser.addEventListener(
      "load",
      () => {
        browser.contentWindow.displayMessage(hdr.folder.getUriForMsg(hdr), gViewWrapper);
      },
      { capture: true, once: true }
    );
    browser.addEventListener(
      "MsgLoaded",
      () => {
        // The subject is at the top of the conversation, the sender and date in the card header: keep only the reader's buttons (Reply...) and recipients.
        const doc = browser.contentDocument;
        doc.getElementById("singleMessage")?.classList.add("in-conversation");
        if (!doc.getElementById("heron-in-conversation")) {
          const css = doc.createElement("style");
          css.id = "heron-in-conversation";
          css.textContent = `
            #expandedfromRow, #dateLabel { display: none !important; }
            #messageHeader { padding-block: 4px 6px !important; }
          `;
          doc.documentElement.append(css);
        }
        fitHeight(browser);
        // Images and fonts may arrive later: readjust.
        const content = browser.contentDocument.getElementById("messagepane")?.contentDocument;
        if (content?.body) {
          new content.defaultView.ResizeObserver(() => fitHeight(browser)).observe(content.body);
        }
        // The header also changes height (recipient list expanded or collapsed).
        const messageHeader = doc.getElementById("messageHeader");
        if (messageHeader) {
          new browser.contentWindow.ResizeObserver(() => fitHeight(browser)).observe(messageHeader);
        }
        card.classList.remove("heron-unread");
      },
      { capture: true }
    );
    body.append(browser);
  }

  function closeReader(card) {
    const browser = card.querySelector(".heron-body > browser");
    if (browser) {
      try {
        browser.contentWindow?.displayMessage?.();
      } catch {}
      browser.remove();
    }
  }

  function setExpanded(card, expanded) {
    card.setAttribute("aria-expanded", String(expanded));
    if (expanded) {
      openReader(card, card.heronHdr);
    } else {
      closeReader(card);
    }
  }

  // --- Rendering ------------------------------------------------------------------------------

  let current = null; // { rootKey, hdrs, cards: Map(messageId → card) }

  function buildCard(hdr) {
    const card = document.createElement("article");
    card.className = "heron-msg";
    card.heronHdr = hdr;
    card.dataset.id = hdr.messageId;
    if (!hdr.isRead) {
      card.classList.add("heron-unread");
    }
    const who = author(hdr);
    if (myAddresses().has(who.email.toLowerCase())) {
      card.classList.add("heron-mine");
    }
    const head = document.createElement("div");
    head.className = "heron-head";
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    const avatar = document.createElement("span");
    avatar.className = "heron-avatar";
    avatar.textContent = (who.name.trim()[0] ?? "?").toUpperCase();
    avatar.style.background = colorFor(who.email || who.name);
    const name = document.createElement("span");
    name.className = "heron-name";
    name.textContent = who.name;
    name.title = who.email;
    const date = document.createElement("span");
    date.className = "heron-date";
    const when = new Date(hdr.date / 1000);
    date.textContent = makeFriendlyDateAgo(when);
    date.title = when.toLocaleString();
    const snippet = document.createElement("span");
    snippet.className = "heron-snippet";
    fillSnippet(hdr, snippet);
    head.append(avatar, name, date, snippet);
    const toggle = () => setExpanded(card, card.getAttribute("aria-expanded") != "true");
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", event => {
      if (event.key == "Enter" || event.key == " ") {
        event.preventDefault();
        toggle();
      }
    });
    const body = document.createElement("div");
    body.className = "heron-body";
    card.append(head, body);
    card.setAttribute("aria-expanded", "false");
    return card;
  }

  function render(hdrs, { keepState = false } = {}) {
    const previous = keepState ? current?.cards : null;
    const newestFirst = config().conversationOrder == "newest-first";
    hdrs = uniqueById(hdrs).sort(byDate);
    const ordered = newestFirst ? [...hdrs].reverse() : hdrs;

    const header = document.createElement("header");
    const title = document.createElement("h1");
    title.textContent = hdrs.at(-1)?.mime2DecodedSubject ?? "";
    const meta = document.createElement("span");
    meta.className = "heron-meta";
    const unread = hdrs.filter(h => !h.isRead).length;
    meta.textContent = unread
      ? t("conversationCountUnread", String(hdrs.length), String(unread))
      : t("conversationCount", String(hdrs.length));
    const all = document.createElement("button");
    all.type = "button";
    header.append(title, meta, all);

    const cards = new Map();
    const fragment = document.createDocumentFragment();
    for (const hdr of ordered) {
      // Reuse cards already shown (and their open readers) when the thread is completed.
      const card = previous?.get(hdr.messageId) ?? buildCard(hdr);
      cards.set(hdr.messageId, card);
      fragment.append(card);
    }
    for (const [id, card] of previous ?? []) {
      if (!cards.has(id)) {
        closeReader(card);
      }
    }
    if (!keepState) {
      for (const card of view.querySelectorAll(".heron-msg")) {
        closeReader(card);
      }
    }
    view.replaceChildren(header, fragment);
    current = { ...current, hdrs, cards, allButton: all };
    all.addEventListener("click", () => {
      const expand = [...cards.values()].some(c => c.getAttribute("aria-expanded") != "true");
      for (const card of cards.values()) {
        setExpanded(card, expand);
      }
      updateAllButton();
    });

    if (!keepState) {
      // Expanded automatically: the newest, then the unread ones (up to MAX_AUTO_OPEN).
      const toOpen = [hdrs.at(-1), ...hdrs.filter(h => !h.isRead).reverse()];
      const opened = new Set();
      for (const hdr of toOpen) {
        if (hdr && opened.size < MAX_AUTO_OPEN && !opened.has(hdr.messageId)) {
          opened.add(hdr.messageId);
          setExpanded(cards.get(hdr.messageId), true);
        }
      }
      // Scroll to the newest.
      const newest = cards.get(hdrs.at(-1)?.messageId);
      if (newestFirst) {
        view.scrollTop = 0;
      } else {
        requestAnimationFrame(() => newest?.scrollIntoView({ block: "start" }));
      }
    }
    updateAllButton();
  }

  /** "Expand all" while any message is collapsed, otherwise "Collapse all". */
  function updateAllButton() {
    if (!current?.allButton) {
      return;
    }
    const anyClosed = [...current.cards.values()].some(c => c.getAttribute("aria-expanded") != "true");
    current.allButton.textContent = anyClosed ? t("conversationExpandAll") : t("conversationCollapseAll");
  }
  view.addEventListener("click", () => setTimeout(updateAllButton, 0));

  function show(hdrs) {
    const root = gDBView.getThreadContainingMsgHdr(hdrs[0]).getRootHdr();
    const rootKey = `${root.folder.URI}#${root.messageKey}`;
    view.hidden = false;
    current = { rootKey };
    render(hdrs);
    withIndexedMessages(root, indexed => {
      if (current?.rootKey != rootKey || view.hidden) {
        return; // the user has moved on
      }
      const known = new Set(current.hdrs.map(h => h.messageId));
      const extra = indexed.filter(h => !known.has(h.messageId));
      if (!extra.length) {
        return;
      }
      render([...current.hdrs, ...extra], { keepState: true });
      // The newest may come from another folder (a reply in Sent): expand it.
      const newest = current.cards.get(current.hdrs.at(-1).messageId);
      if (newest && extra.some(h => h.messageId == newest.dataset.id)) {
        setExpanded(newest, true);
        updateAllButton();
        if (config().conversationOrder != "newest-first") {
          requestAnimationFrame(() => newest.scrollIntoView({ block: "start" }));
        }
      }
    });
  }

  function hide() {
    if (view.hidden) {
      return;
    }
    view.hidden = true;
    for (const card of view.querySelectorAll(".heron-msg")) {
      closeReader(card);
    }
    view.replaceChildren();
    current = null;
  }

  // --- Hooking into the message pane --------------------------------------------------

  /** Is a single thread selected (one conversation row)? */
  function isSingleThread(messages) {
    if (messages.length < 2 || gDBView?.selection?.count != 1) {
      return false;
    }
    const rootOf = m => gDBView.getThreadContainingMsgHdr(m).getRootHdr().messageKey;
    const first = rootOf(messages[0]);
    return messages.every(m => rootOf(m) == first);
  }

  // On stop: the shown thread is handed to Thunderbird's message pane. Registered before the wrappers, so it runs after they are removed (the display really goes through Thunderbird).
  heronOnStop(() => {
    const shown = !view.hidden;
    hide();
    view.remove();
    style.remove();
    delete document.documentElement.dataset.heronConversation;
    if (shown) {
      pane.displayMessages(gDBView?.getSelectedMsgHdrs() ?? []);
    }
  });

  heronWrap(pane, "displayMessages", displayMessages => function (messages = []) {
    if (config().conversations !== false && isSingleThread(messages)) {
      displayMessages.call(pane, []); // clear the other readers
      try {
        show(messages);
        return;
      } catch (e) {
        console.error("heron: conversation", e);
        hide();
      }
    }
    hide();
    displayMessages.call(pane, messages);
  });
  for (const name of ["displayMessage", "displayWebPage", "clearAll"]) {
    heronWrap(pane, name, method => function (...args) {
      hide();
      return method.apply(pane, args);
    });
  }

})();
