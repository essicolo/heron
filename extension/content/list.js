/* heron: message list (module "list"): dates, sender, preview.
 *
 * Run by api/implementation.js in a sandbox whose prototype is the about:3pane window.
 *
 * (One row per conversation: separate module, threads.js.)
 * - Date: Thunderbird's own (makeFriendlyDateAgo, in its UI language): the time today, "yesterday", the weekday, "Aug 28", then the full date. The exact date stays on hover.
 * - Sender: only the name is shown (theme setting); the real domain is added discreetly, and flagged in red when it does not match what the name suggests.
 * - Text preview under the subject (third line of the cards), computed by Thunderbird.
 */
(() => {
  if (document.documentElement.dataset.heronList) {
    return;
  }
  document.documentElement.dataset.heronList = "1";

  const { makeFriendlyDateAgo } = ChromeUtils.importESModule("resource:///modules/TemplateUtils.sys.mjs");
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);
  const norm = s => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  // ==========================================================================================
  // Sender: real domain and impersonation signals
  // ==========================================================================================

  /** Relay services: the real address differs from the display name, and that is expected. */
  const RELAYS = ["relay.firefox.com", "mozmail.com", "duck.com", "simplelogin.com", "simplelogin.co",
    "anonaddy.me", "addy.io", "privaterelay.appleid.com"];

  /**
   * Frequently impersonated brands: word in the name (without accents) → legitimate domain names (without suffix).
   * Deliberately short list: better to say nothing than cry wolf.
   */
  const BRANDS = {
    paypal: ["paypal"],
    apple: ["apple", "icloud"],
    icloud: ["apple", "icloud"],
    microsoft: ["microsoft", "outlook", "live", "office", "office365", "microsoftonline", "hotmail"],
    outlook: ["microsoft", "outlook", "live", "office"],
    google: ["google", "gmail", "youtube"],
    gmail: ["google", "gmail"],
    amazon: ["amazon"],
    netflix: ["netflix"],
    facebook: ["facebook", "facebookmail", "meta"],
    instagram: ["instagram", "facebookmail", "meta"],
    desjardins: ["desjardins"],
    interac: ["interac"],
    "postes canada": ["postescanada", "canadapost"],
    "canada post": ["postescanada", "canadapost"],
    "revenu quebec": ["revenuquebec"],
    "hydro-quebec": ["hydroquebec"],
    docusign: ["docusign"],
    dhl: ["dhl"],
    fedex: ["fedex"],
    purolator: ["purolator"],
  };

  /** "mail.anthropic.com" → "anthropic.com"; "avis.quebec.gouv.qc.ca" → "quebec.gouv.qc.ca". */
  function baseDomain(host) {
    try {
      return Services.eTLD.getBaseDomainFromHost(host);
    } catch {
      return host;
    }
  }

  /** Impersonation signal for this sender, or null. */
  function warning(name, host) {
    const domain = baseDomain(host);
    // 1. The name contains an address from another domain ("service@paypal.com" <x@paypa1-secure.ru>).
    const named = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/.exec(name);
    if (named && baseDomain(named[1].toLowerCase()) != domain) {
      return t("listWarnAddress", named[0], host);
    }
    // 2. The name suggests a brand, the address comes from elsewhere ("PayPal" <x@paypa1-secure.ru>).
    const label = norm(domain.split(".")[0]);
    const words = norm(name);
    for (const [brand, legit] of Object.entries(BRANDS)) {
      // The domain must be exactly the brand's: "desjardins-verification.com" is not.
      if (new RegExp(`\\b${brand}\\b`).test(words) && !legit.includes(label)) {
        return t("listWarnBrand", brand.replace(/\b\p{L}/gu, c => c.toUpperCase()), host);
      }
    }
    // 3. Internationalized domain: its letters may imitate another name.
    if (host.split(".").some(part => part.startsWith("xn--"))) {
      return t("listWarnPunycode", host);
    }
    return null;
  }

  function senderInfo(hdr) {
    const [address] = MailServices.headerParser.parseDecodedHeader(hdr.mime2DecodedAuthor);
    const email = address?.email ?? "";
    const name = address?.name ?? "";
    const host = (email.split("@")[1] ?? "").toLowerCase();
    const relay = RELAYS.some(r => host == r || host.endsWith(`.${r}`));
    return {
      email,
      name,
      host,
      domain: host ? baseDomain(host) : "",
      relay,
      warning: host && !relay ? warning(name, host) : null,
    };
  }

  /** For a collapsed thread row, its newest message (whose preview is shown). */
  function newestOfCollapsedThread(index) {
    if (!gDBView.isContainer(index) || gDBView.isContainerOpen(index)) {
      return null;
    }
    const thread = gDBView.getThreadContainingIndex(index);
    let newest = null;
    for (let i = 0; i < thread.numChildren; i++) {
      const hdr = thread.getChildHdrAt(i);
      if (hdr && (!newest || hdr.date > newest.date)) {
        newest = hdr;
      }
    }
    return newest;
  }

  // ==========================================================================================
  // Text preview (third line of the cards)
  // ==========================================================================================

  const previewOn = () => heronConfig?.preview !== false;
  /** Messages whose preview was already requested: "folder#key". */
  const requested = new Set();
  /** Requests grouped by folder, sent together. */
  const pending = new Map(); // folder → Set(keys)
  let flushTimer = null;

  /**
   * Preview computed by Thunderbird (fetchMsgPreviewText, the one its notifications use), stored in the message. Only for messages available on this computer: never downloads from the server for a preview.
   */
  function previewOf(hdr) {
    const text = hdr.getStringProperty("preview");
    if (text) {
      return text.replace(/\s+/g, " ").trim();
    }
    const local = ["none", "pop3"].includes(hdr.folder?.server?.type);
    const offline = hdr.flags & Ci.nsMsgMessageFlags.Offline;
    const id = `${hdr.folder?.URI}#${hdr.messageKey}`;
    if ((local || offline) && !requested.has(id)) {
      requested.add(id);
      if (!pending.has(hdr.folder)) {
        pending.set(hdr.folder, new Set());
      }
      pending.get(hdr.folder).add(hdr.messageKey);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flushPreviews, 60);
    }
    return "";
  }

  function flushPreviews() {
    for (const [folder, keys] of pending) {
      try {
        folder.fetchMsgPreviewText([...keys], {
          // nsIUrlListener (lowercase method names since Thunderbird 128).
          onStartRunningUrl() {},
          onStopRunningUrl: () => threadTree?.invalidate(),
        });
      } catch (e) {
        console.error("heron: preview", e);
      }
    }
    pending.clear();
    // Local folders answer right away, without notifying: redraw as well.
    setTimeout(() => threadTree?.invalidate(), 50);
  }

  // A setting changed (preview on/off): redraw the list.
  globalThis.heronConfigChanged = () => document.getElementById("threadTree")?.invalidate();

  // ==========================================================================================
  // Card rendering
  // ==========================================================================================

  const style = document.createElement("style");
  style.textContent = `
    tr.card-layout .sender { flex: 0 1 auto; min-width: 0; }
    tr.card-layout .heron-domain {
      flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-inline: 6px auto; font-size: 0.9em; font-weight: normal; color: var(--layout-color-2, GrayText);
    }
    tr.card-layout .heron-domain.heron-warn { color: #e5484d; font-weight: 600; }
    /* Preview: in the "button | icons" line of the three-line card (the button is hidden). */
    #threadTree:not(.cards-row-compact) tr.card-layout .thread-card-dynamic-row {
      grid-template: "subject subject" max-content "preview info" minmax(auto, 1fr) / 1fr auto !important;
    }
    tr.card-layout .heron-preview {
      grid-area: preview; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      font-size: 0.92em; font-weight: normal; color: var(--layout-color-2, GrayText);
    }
    #threadTree.cards-row-compact .heron-preview { display: none; }
  `;
  document.head.appendChild(style);

  /** Folders where the card shows the recipient, not the sender. */
  const OUTGOING = Ci.nsMsgFolderFlags.SentMail | Ci.nsMsgFolderFlags.Drafts |
    Ci.nsMsgFolderFlags.Queue | Ci.nsMsgFolderFlags.Templates;

  function ensure(row, className, after) {
    let el = row.querySelector(`.${className}`);
    if (!el) {
      el = document.createElement("span");
      el.className = className;
      after.after(el);
    }
    return el;
  }

  function decorate(row) {
    if (row.dataset.properties?.split(" ").includes("dummy")) {
      return;
    }
    const hdr = row.view?.getMsgHdrAt(row._index);
    if (!hdr) {
      return;
    }
    const tag = ensure(row, "heron-domain", row.senderLine);
    let preview = row.querySelector(".heron-preview");
    if (!preview) {
      preview = document.createElement("span");
      preview.className = "heron-preview";
      row.querySelector(".thread-card-dynamic-row")?.append(preview);
    }
    tag.textContent = tag.title = "";
    tag.classList.remove("heron-warn");

    // Preview: for a collapsed thread, that of the latest message.
    preview.textContent = previewOn() ? previewOf(newestOfCollapsedThread(row._index) ?? hdr) : "";

    // Friendly date (exact on hover) and sender domain.
    const exact = row.dateLine.textContent;
    row.dateLine.textContent = makeFriendlyDateAgo(new Date(hdr.date / 1000));
    row.dateLine.title = exact;
    if (hdr.folder?.isSpecialFolder(OUTGOING, true)) {
      return;
    }
    const info = senderInfo(hdr);
    row.senderLine.title = info.name ? `${info.name} <${info.email}>` : info.email;
    if (info.warning) {
      tag.textContent = `⚠ ${info.domain}`;
      tag.title = info.warning;
      tag.classList.add("heron-warn");
    } else if (info.domain && info.name) {
      tag.textContent = info.relay ? t("listVia", info.host) : info.domain;
    }
  }

  // The card is defined by a module loaded with the page: wait until it exists.
  customElements.whenDefined("thread-card").then(ThreadCard => {
    if (heronStopped) {
      return;
    }
    heronWrap(ThreadCard.prototype, "fillRow", fillRow => function () {
      fillRow.call(this);
      try {
        decorate(this);
      } catch (e) {
        console.error("heron: list", e);
      }
    });
    document.getElementById("threadTree")?.invalidate();
  });

  // On stop: the cards revert to Thunderbird's own.
  heronOnStop(() => {
    clearTimeout(flushTimer);
    style.remove();
    document.querySelectorAll(".heron-domain, .heron-preview").forEach(el => el.remove());
    delete globalThis.heronConfigChanged;
    delete document.documentElement.dataset.heronList;
    document.getElementById("threadTree")?.invalidate();
  });
})();
