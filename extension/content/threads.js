/* heron: one row per conversation (module "threads").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the about:3pane window.
 * Independent of the other modules (it also works without the conversation view or the list).
 *
 * - When a folder opens, the list is grouped by threads, all collapsed.
 * - Threads can no longer be expanded in the list: no twisty, no "N replies" button, no Right arrow key (the thread opens in the message pane).
 * - A conversation row shows the participants ("Olivier, Camille and Léa-Émilie"), the message count and the date of the latest message.
 */
(() => {
  if (document.documentElement.dataset.heronThreads) {
    return;
  }
  document.documentElement.dataset.heronThreads = "1";

  const { makeFriendlyDateAgo } = ChromeUtils.importESModule("resource:///modules/TemplateUtils.sys.mjs");
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);
  const listFormat = new Intl.ListFormat(Services.locale.appLocalesAsBCP47, { type: "conjunction" });

  // --- Grouped by threads, collapsed -------------------------------------------------------

  function oneRowPerConversation() {
    const wrapper = gViewWrapper;
    if (!wrapper || wrapper.isSynthetic || !gFolder || wrapper.showGroupedBySort) {
      return;
    }
    if (!wrapper.showThreaded) {
      wrapper.showThreaded = true;
    }
    gDBView?.doCommand(Ci.nsMsgViewCommandType.collapseAll);
  }
  heronListen(window, "folderURIChanged", () => setTimeout(oneRowPerConversation, 0));
  oneRowPerConversation();

  // The keyboard no longer expands a thread in the list.
  heronListen(
    document.getElementById("threadTree"),
    "keydown",
    event => {
      if (["ArrowRight", "*"].includes(event.key) && !event.altKey && !event.metaKey && !event.ctrlKey) {
        const index = threadTree.currentIndex;
        if (index >= 0 && gDBView?.isContainer(index)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    },
    true
  );

  // --- Participants, message count, latest date ----------------------------------------

  /** First name (or address without domain) of a sender. */
  function shortName(author) {
    const [address] = MailServices.headerParser.parseDecodedHeader(author);
    const name = address?.name && !address.name.includes("@") ? address.name : "";
    return name ? name.split(/\s+/)[0] : (address?.email ?? author).split("@")[0];
  }

  /** For a collapsed thread row (at least 2 messages): { count, participants, newest }; otherwise null. */
  function threadInfo(index) {
    if (!gDBView.isContainer(index) || gDBView.isContainerOpen(index)) {
      return null;
    }
    const thread = gDBView.getThreadContainingIndex(index);
    const count = thread.numChildren;
    if (count < 2) {
      return null;
    }
    const names = [];
    let newest = 0;
    for (let i = 0; i < count; i++) {
      const hdr = thread.getChildHdrAt(i);
      if (!hdr) {
        continue;
      }
      newest = Math.max(newest, hdr.date);
      const name = shortName(hdr.mime2DecodedAuthor);
      if (!names.includes(name)) {
        names.push(name);
      }
    }
    const shown = names.length > 3 ? [...names.slice(0, 2), t("listOthers", String(names.length - 2))] : names;
    return { count, participants: listFormat.format(shown), newest: new Date(newest / 1000) };
  }

  const style = document.createElement("style");
  style.textContent = `
    /* No twisty or "N replies" button: they expand the thread. */
    #threadTree .thread-card-button, #threadTree .twisty { display: none !important; }
    tr.card-layout .sender { flex: 0 1 auto; min-width: 0; }
    tr.card-layout .heron-count {
      flex: 0 0 auto; margin-inline: 6px auto; padding: 0 7px; border-radius: 999px;
      font-size: 0.8em; font-weight: 600; line-height: 1.5;
      color: var(--layout-color-2, GrayText); background: color-mix(in srgb, currentColor 12%, transparent);
    }
    tr.card-layout .heron-count:empty { display: none; }
  `;
  document.head.appendChild(style);

  function decorate(row) {
    if (row.dataset.properties?.split(" ").includes("dummy")) {
      return;
    }
    let count = row.querySelector(".heron-count");
    if (!count) {
      count = document.createElement("span");
      count.className = "heron-count";
      row.senderLine.after(count);
    }
    count.textContent = "";
    const thread = threadInfo(row._index);
    if (!thread) {
      return;
    }
    row.senderLine.textContent = thread.participants;
    row.senderLine.title = thread.participants;
    count.textContent = String(thread.count);
    count.title = t("listCount", String(thread.count));
    row.dateLine.textContent = makeFriendlyDateAgo(thread.newest);
    row.dateLine.title = thread.newest.toLocaleString();
    // A single sender's domain makes no sense for a conversation (module "list").
    const domain = row.querySelector(".heron-domain");
    if (domain) {
      domain.textContent = domain.title = "";
      domain.classList.remove("heron-warn");
    }
  }

  customElements.whenDefined("thread-card").then(ThreadCard => {
    if (heronStopped) {
      return;
    }
    heronWrap(ThreadCard.prototype, "fillRow", fillRow => function () {
      fillRow.call(this);
      try {
        decorate(this);
      } catch (e) {
        console.error("heron: conversations in the list", e);
      }
    });
    document.getElementById("threadTree")?.invalidate();
  });

  // On stop: twisties and thread buttons come back, rows get their original content.
  // (Grouping by threads is a view choice Thunderbird remembers: it stays.)
  heronOnStop(() => {
    style.remove();
    document.querySelectorAll(".heron-count").forEach(el => el.remove());
    delete document.documentElement.dataset.heronThreads;
    document.getElementById("threadTree")?.invalidate();
  });
})();
