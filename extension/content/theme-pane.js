/* heron: appearance, dynamic part of the mail tab (module "theme").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the about:3pane window.
 * The rest of the appearance is in CSS (styles/theme.css).
 *
 * - "New Message": envelope and "Write", centered; the envelope alone when the pane is too narrow.
 * - Folder pane and message list headers: same height, for a continuous line below them.
 */
(() => {
  if (document.documentElement.dataset.heronThemePane) {
    return;
  }
  document.documentElement.dataset.heronThemePane = "1";
  heronOnStop(() => delete document.documentElement.dataset.heronThemePane);

  // --- "New Message" -------------------------------------------------------------------------
  // Thunderbird's "new message" envelope and "Write", at natural width, centered in the bar. When the folder pane is too narrow, the envelope alone in a square button. The full label is always the tooltip.
  const write = document.getElementById("folderPaneWriteMessage");
  const style = document.createElement("style");
  style.textContent = `
    #folderPaneWriteMessage {
      flex: 0 1 auto !important;
      min-width: 0 !important;
      background-image: url("chrome://messenger/skin/icons/new/compact/new-mail.svg") !important;
      background-position: 12px 50% !important;
      padding-inline: 36px 14px !important;
      font-size: 0 !important;
    }
    #folderPaneWriteMessage::after { content: attr(data-heron-short); font-size: var(--heron-write-font); }
    #folderPaneWriteMessage.heron-compact {
      flex: 0 0 34px !important;
      width: 34px !important;
      padding: 0 !important;
      background-position: center !important;
    }
    #folderPaneWriteMessage.heron-compact::after { content: none; }
  `;
  document.head.appendChild(style);
  heronOnStop(() => style.remove());

  if (write) {
    const t = key => heronStrings?.[key] || key;
    write.dataset.heronShort = t("writeShort");
    write.style.setProperty("--heron-write-font", getComputedStyle(write.parentElement).fontSize);
    const fit = () => {
      write.classList.remove("heron-compact");
      write.title = write.textContent.trim();
      if (write.scrollWidth > write.clientWidth) {
        write.classList.add("heron-compact");
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(write.parentElement);
    fit();
    heronOnStop(() => {
      observer.disconnect();
      write.classList.remove("heron-compact");
      write.removeAttribute("title");
      delete write.dataset.heronShort;
      write.style.removeProperty("--heron-write-font");
    });
  }

  // --- Pane headers: same height ----------------------------------------------------------------
  // The list bar grows when the count wraps onto two lines: the folder bar follows, so the line under both stays a single stroke.

  const headers = ["folderPaneHeaderBar", "threadPaneHeaderBar"].map(id => document.getElementById(id));
  if (headers.every(Boolean)) {
    const root = document.documentElement;
    const align = () => {
      root.style.removeProperty("--heron-header-height");
      const height = Math.max(...headers.map(h => h.getBoundingClientRect().height));
      root.style.setProperty("--heron-header-height", `${Math.ceil(height)}px`);
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(align));
    for (const header of headers) {
      for (const child of header.children) {
        observer.observe(child);
      }
    }
    align();
    heronOnStop(() => {
      observer.disconnect();
      root.style.removeProperty("--heron-header-height");
    });
  }
})();
