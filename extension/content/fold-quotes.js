/* heron: folds the reply history in a displayed message.
 *
 * Injected into each message by messenger.messageDisplayScripts (see background.js), and by api/implementation.js into the conversation view readers.
 *
 * Detects, in HTML and plain text:
 * - marked signatures (Thunderbird, Gmail, Outlook web) and "--" in plain text;
 * - quotes (Thunderbird and Apple Mail blockquote, gmail_quote), with their "On ... wrote:" line;
 * - the Outlook "From: ... Sent: ..." header (desktop, web, plain text), whatever its markup (bold, links, non-breaking spaces), and "-----Original Message-----".
 * Consecutive folds (signature, header, history) are merged behind a single "•••" button.
 * Text is never removed, only hidden.
 */
(() => {
  // Marker in the (shared) DOM: the script can arrive by two paths, it must run only once.
  if (document.documentElement.dataset.heronFolded) {
    return;
  }
  document.documentElement.dataset.heronFolded = "1";

  // Button text: translated by the extension (sandbox) or by browser.i18n (content script).
  const TOGGLE_LABEL =
    (typeof heronStrings == "object" && heronStrings?.foldToggle) ||
    globalThis.browser?.i18n?.getMessage("foldToggle") ||
    "•••";

  const style = document.createElement("style");
  style.textContent = `
    .heron-folded { display: none !important; }
    .heron-toggle {
      all: unset; box-sizing: border-box; cursor: pointer;
      display: inline-block; margin: 6px 0; padding: 0 10px;
      border-radius: 10px; line-height: 18px; font: 600 12px/18px system-ui, sans-serif;
      letter-spacing: 1px; color: GrayText; background: color-mix(in srgb, CanvasText 8%, transparent);
    }
    .heron-toggle:hover, .heron-toggle:focus-visible { background: color-mix(in srgb, CanvasText 16%, transparent); color: CanvasText; }
  `;
  document.head.appendChild(style);

  /** Spaces, including non-breaking ones (French "De :" is often written "De&nbsp;:"). */
  const SP = "[\\s\\u00a0\\u202f]";
  const blank = text => !text.replace(/[\s  ]/g, "");

  // ==========================================================================================
  // Folds
  // ==========================================================================================

  /** Folds added so far: { containers, button }. */
  const folds = [];

  /** Hides sibling nodes in a container (inserted in place of the first one). */
  function hide(nodes) {
    const container = document.createElement("div");
    container.className = "heron-folded";
    nodes[0].parentNode.insertBefore(container, nodes[0]);
    for (const node of nodes) {
      container.appendChild(node);
    }
    return container;
  }

  /** Hides several groups of nodes behind a single button, placed before the first group. */
  function addFold(groups) {
    groups = groups
      .map(nodes => nodes.filter(n => n.parentNode && !n.parentElement?.closest(".heron-folded")))
      .filter(nodes => nodes.length);
    if (!groups.length) {
      return;
    }
    const fold = { containers: groups.map(hide), button: document.createElement("button") };
    const { button } = fold;
    button.type = "button";
    button.className = "heron-toggle";
    button.textContent = "•••";
    button.title = TOGGLE_LABEL;
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") != "true";
      for (const c of fold.containers) {
        c.classList.toggle("heron-folded", !open);
      }
      button.setAttribute("aria-expanded", String(open));
    });
    fold.containers[0].parentNode.insertBefore(button, fold.containers[0]);
    folds.push(fold);
  }

  /** All following siblings of `node`, including `node`. */
  function fromHere(node) {
    const nodes = [];
    for (let n = node; n; n = n.nextSibling) {
      nodes.push(n);
    }
    return nodes;
  }

  /** Block holding the message text (not the attachments shown below it). */
  const rootOf = node =>
    node.parentElement?.closest(".moz-text-plain, .moz-text-flowed, .moz-text-html") ?? document.body;

  /** From `node` to the end of the message: its following siblings, then those of each parent. */
  function toEnd(node) {
    const root = rootOf(node);
    const groups = [fromHere(node)];
    for (let p = node.parentNode; p && p != root && p != document.body; p = p.parentNode) {
      if (p.nextSibling) {
        groups.push(fromHere(p.nextSibling));
      }
    }
    return groups;
  }

  /** Node with no visible content (space, line break, empty element without an image). */
  const empty = node =>
    node.nodeType == Node.TEXT_NODE
      ? blank(node.data)
      : node.nodeType == Node.ELEMENT_NODE && blank(node.textContent) && !node.querySelector?.("img") &&
        node.localName != "img" && node.localName != "hr";

  /** Previous sibling with visible content. */
  function previousMeaningful(node) {
    let n = node.previousSibling;
    while (n && (empty(n) || n.nodeType == Node.COMMENT_NODE)) {
      n = n.previousSibling;
    }
    return n;
  }

  // ==========================================================================================
  // 1. Signatures
  // ==========================================================================================

  const SIGNATURE =
    ".moz-signature, .moz-txt-sig, .gmail_signature, #Signature, #signature, div[data-smartmail='gmail_signature']";
  for (const signature of document.querySelectorAll(SIGNATURE)) {
    if (signature.closest("blockquote, .gmail_quote, .heron-folded")) {
      continue;
    }
    // The "--" separator before it (Gmail keeps it apart) goes with it.
    const nodes = [signature];
    for (let n = signature.previousSibling; n; n = n.previousSibling) {
      if (empty(n) || n.localName == "br" || n.classList?.contains("gmail_signature_prefix") ||
          (n.nodeType == Node.TEXT_NODE && /^\s*--\s*$/.test(n.data))) {
        nodes.unshift(n);
      } else {
        break;
      }
    }
    while (nodes.length > 1 && empty(nodes[0])) {
      nodes.shift(); // no leading space: the button stays next to the text
    }
    addFold([nodes]);
  }

  // Plain text: "--" alone on its line, followed by a few lines.
  for (const root of document.querySelectorAll(".moz-text-plain, .moz-text-flowed")) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest("blockquote, .heron-folded")) {
        continue;
      }
      const m = /^-- ?$/m.exec(n.data);
      if (m) {
        const tail = m.index > 0 ? n.splitText(m.index) : n;
        // Only if the signature is short (otherwise it is probably not a signature).
        if (tail.data.split("\n").length <= 12) {
          addFold([fromHere(tail)]);
        }
        break;
      }
    }
  }

  // ==========================================================================================
  // 2. Quotes (top level only: nested ones come along), with "On ... wrote:"
  // ==========================================================================================

  const ATTRIBUTION = new RegExp(`(?:a écrit|wrote|schrieb|escribió|ha scritto)${SP}*:?${SP}*$`, "i");

  for (const quote of document.querySelectorAll("blockquote[type='cite'], .gmail_quote, .moz-email-quote")) {
    if (quote.parentElement?.closest("blockquote[type='cite'], .gmail_quote, .heron-folded")) {
      continue;
    }
    const nodes = [quote];
    const before = previousMeaningful(quote);
    if (before?.classList?.contains("moz-cite-prefix")) {
      nodes.unshift(...fromHere(before).slice(0, fromHere(before).indexOf(quote)));
    } else if (before?.nodeType == Node.TEXT_NODE && ATTRIBUTION.test(before.data)) {
      // The last line of the preceding text: "On Oct 19, 2026, Charles wrote:".
      const lineStart = before.data.trimEnd().lastIndexOf("\n") + 1;
      const line = lineStart > 0 ? before.splitText(lineStart) : before;
      nodes.unshift(...fromHere(line).slice(0, fromHere(line).indexOf(quote)));
    }
    addFold([nodes]);
  }

  // ==========================================================================================
  // 3. "From: ... Sent: ..." header (Outlook) and "-----Original Message-----" separators
  // ==========================================================================================

  // Outlook web: the block has an id.
  const outlook = document.querySelector("#divRplyFwdMsg, #appendonsend");
  if (outlook && !outlook.closest(".heron-folded")) {
    const hr = previousMeaningful(outlook);
    addFold(toEnd(outlook.id == "divRplyFwdMsg" && hr?.localName == "hr" ? hr : outlook));
  }

  // Elsewhere, read the text whatever the markup: "De" or "From" at the start of a line, then "Envoyé", "Sent" or "Date" in the following lines.
  const LABEL = new RegExp(`(^|\\n)[ \\t\\u00a0]*(?:De|From|Von|Da)${SP}*:`, "g");
  const NEXT = new RegExp(`(?:Envoy[ée]|Sent|Date|Enviado|Fecha|Gesendet|Inviato)${SP}*:`);
  const SEPARATOR = new RegExp(
    `(^|\\n)[ \\t]*-{2,}${SP}*(?:Original Message|Message d.origine|Forwarded message|Message transf[ée]r[ée]|Mensaje original|Mensaje reenviado)${SP}*-{2,}`,
    "gi"
  );

  const isBlock = el => el.nodeType == Node.ELEMENT_NODE &&
    !["inline", "contents"].includes(document.defaultView.getComputedStyle(el)?.display ?? "block");

  /** Does text `node` start a line? (preceded by a line break, a <br> or a block) */
  function startsLine(node) {
    let n = node;
    for (;;) {
      while (!n.previousSibling) {
        n = n.parentNode;
        if (!n || isBlock(n) || n == document.body) {
          return true;
        }
      }
      n = n.previousSibling;
      while (n.lastChild && !isBlock(n)) {
        n = n.lastChild;
      }
      if (n.localName == "br" || isBlock(n)) {
        return true;
      }
      if (n.nodeType == Node.TEXT_NODE) {
        if (/\n[ \t ]*$/.test(n.data) || n.data == "") {
          return true;
        }
        if (!blank(n.data)) {
          return false;
        }
      }
    }
  }

  /** First history header in the message: { node, index } or null. */
  function findHistory() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      // (Thunderbird header tables, "From: ... Date:", are not history.)
      if (n.parentElement.closest(".heron-folded, .heron-toggle, style, script, [class*=\"moz-header\"]")) {
        continue;
      }
      for (const re of [LABEL, SEPARATOR]) {
        re.lastIndex = 0;
        for (let m; (m = re.exec(n.data)); ) {
          const index = m.index + m[1].length;
          if (!m[1] && index == 0 && !startsLine(n)) {
            continue;
          }
          if (re == SEPARATOR) {
            return { node: n, index };
          }
          // What follows (text of this node and the next ones) must contain "Envoyé / Sent / Date".
          const range = document.createRange();
          range.setStart(n, index);
          const root = rootOf(n);
          range.setEnd(root, root.childNodes.length);
          const after = range.toString().slice(0, 400);
          if (NEXT.test(after.slice(after.indexOf(":") + 1))) {
            return { node: n, index };
          }
        }
      }
    }
    return null;
  }

  const history = findHistory();
  if (history) {
    let start = history.index > 0 ? history.node.splitText(history.index) : history.node;
    // Climb up to the block that starts with this header (e.g. the Outlook frame), without leaving the message block; the rule before it (Outlook) is folded too.
    const root = rootOf(start);
    while (start.parentNode && start.parentNode != root && start.parentNode != document.body &&
           !previousMeaningful(start)) {
      start = start.parentNode;
    }
    const hr = previousMeaningful(start);
    addFold(toEnd(hr?.localName == "hr" ? hr : start));
  }

  // ==========================================================================================
  // 4. Consecutive folds (signature, header, history): a single button
  // ==========================================================================================

  folds.sort((a, b) => (a.button.compareDocumentPosition(b.button) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const merged = [];
  for (const fold of folds) {
    const previous = merged.at(-1);
    if (previous) {
      const between = document.createRange();
      between.setStartAfter(previous.containers.at(-1));
      between.setEndBefore(fold.button);
      const gap = between.cloneContents();
      if (blank(gap.textContent) && !gap.querySelector("img")) {
        previous.containers.push(...fold.containers);
        fold.button.remove();
        continue;
      }
    }
    merged.push(fold);
  }
  folds.splice(0, folds.length, ...merged);

  /** Undo the folds when heron stops (privileged version only). */
  if (typeof heronOnStop == "function") {
    heronOnStop(() => {
      for (const { containers, button } of folds) {
        button.remove();
        for (const c of containers) {
          c.replaceWith(...c.childNodes);
        }
      }
      style.remove();
      delete document.documentElement.dataset.heronFolded;
    });
  }
})();
