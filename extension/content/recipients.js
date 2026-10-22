/* heron: collapsible recipient list (module "theme").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the Thunderbird reader (about:message), once per reader.
 *
 * Thunderbird shortens a long recipient list ("To", "Cc") with an "N more" button that expands it, with no way to collapse it again. We add "Less" at the end of the expanded list; the next message is shown collapsed again.
 */
(() => {
  if (window.__heronRecipients) {
    return;
  }
  window.__heronRecipients = true;
  heronOnStop(() => delete window.__heronRecipients);

  const Row = customElements.get("multi-recipient-row");
  if (!Row) {
    return;
  }
  const LESS = heronStrings?.recipientsLess || "−";

  // Once expanded, the list scrolls inside the header (Thunderbird limits its height): "Less" sticks to the bottom of the visible area, otherwise it would be out of view at the end of the list.
  const style = document.createElement("style");
  style.textContent = `
    li.heron-less-item {
      position: sticky; bottom: 2px; z-index: 1; display: inline-block;
      border-radius: 999px; box-shadow: 0 0 0 4px var(--header-background, Canvas);
      background: var(--header-background, Canvas);
    }
  `;
  document.documentElement.append(style);
  heronOnStop(() => style.remove());

  /** Adds "Less" at the end of a list expanded by the user. */
  function addLessButton(row) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "show-more-recipients plain heron-less";
    button.textContent = LESS;
    button.addEventListener("click", () => {
      delete row.dataset.heronExpanded;
      row.buildRecipients(false);
      row.moreButton?.focus();
    });
    const li = document.createElement("li");
    li.className = "heron-less-item";
    li.append(button);
    row.recipientsList.append(li);
  }

  // A new message: its list starts collapsed.
  heronWrap(Row.prototype, "buildView", buildView => function (...args) {
    delete this.dataset.heronExpanded;
    return buildView.apply(this, args);
  });
  heronWrap(Row.prototype, "showAllRecipients", showAll => function (...args) {
    this.dataset.heronExpanded = "1";
    return showAll.apply(this, args);
  });
  heronWrap(Row.prototype, "buildRecipients", build => function (showAllHeaders, ...rest) {
    const result = build.call(this, showAllHeaders, ...rest);
    if (showAllHeaders && this.dataset.heronExpanded) {
      addLessButton(this);
    }
    return result;
  });

  heronOnStop(() => {
    for (const row of document.querySelectorAll("[is='multi-recipient-row'], .multi-recipient-row")) {
      row.querySelector(".heron-less")?.closest("li")?.remove();
      delete row.dataset.heronExpanded;
    }
  });
})();
