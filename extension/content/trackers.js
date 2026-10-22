/* heron: tracker report (module "trackers").
 *
 * Run by api/implementation.js, for each displayed message, in a sandbox whose prototype is the Thunderbird reader (about:message): it sees the header and the content.
 *
 * Thunderbird blocks remote content by default, without saying what it blocked. We find remote images used for tracking (invisible pixels, known open-tracking URLs) and show it with a subtle pill in the header:
 * - remote content blocked: "🛡 2 trackers blocked" (reassuring);
 * - remote content allowed for this sender: "2 trackers active" (so you know).
 * Nothing is shown if there is no tracker. We only look: nothing is loaded.
 */
(() => {
  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);
  const plural = new Intl.PluralRules(Services.locale.appLocaleAsBCP47);

  const content = document.getElementById("messagepane")?.contentDocument;
  const header = document.getElementById("messageHeader");
  if (!content?.body || !header) {
    return;
  }

  /** Typical URLs of open-tracking pixels and bulk mail services. */
  const TRACKING_URL = new RegExp(
    [
      "/open(\\.php|\\.aspx|\\.gif|/|\\?)",
      "/track(ing)?/(open|o)\\b",
      "/wf/open",
      "/e/o/",
      "/pixel",
      "/beacon",
      "list-manage\\.com/track",
      "mandrillapp\\.com/track",
      "sendgrid\\.net/(wf|mpss)/open",
      "mailgun\\.org/o/",
      "sparkpostmail\\.com/q/",
      "exacttarget\\.com/open",
      "hubspot(email)?\\.(com|net)/.*(e2t|open)",
      "google-analytics\\.com/collect",
      "doubleclick\\.net",
      "/t\\.gif",
    ].join("|"),
    "i"
  );

  const isRemote = url => /^https?:/i.test(url ?? "");

  /** A tiny or hidden image: the sign of a tracking pixel. */
  function looksInvisible(img) {
    const w = parseInt(img.getAttribute("width") ?? "", 10);
    const h = parseInt(img.getAttribute("height") ?? "", 10);
    const style = (img.getAttribute("style") ?? "").replace(/\s/g, "").toLowerCase();
    return (
      (w <= 3 && h <= 3) ||
      /(^|;)(display:none|visibility:hidden)/.test(style) ||
      /(^|;)width:[0-3]px/.test(style) ||
      /(^|;)max-height:0/.test(style)
    );
  }

  function findTrackers() {
    const hosts = new Set();
    let count = 0;
    for (const img of content.querySelectorAll("img")) {
      const url = img.getAttribute("src");
      if (isRemote(url) && (looksInvisible(img) || TRACKING_URL.test(url))) {
        count++;
        try {
          hosts.add(new URL(url).hostname);
        } catch {}
      }
    }
    return { count, hosts: [...hosts] };
  }

  function render() {
    header.querySelector("#heron-trackers")?.remove();
    const { count, hosts } = findTrackers();
    if (!count) {
      return;
    }
    const blocked = window.gMessageNotificationBar?.isShowingRemoteContentNotification?.() ?? true;
    const pill = document.createElement("div");
    pill.id = "heron-trackers";
    pill.className = blocked ? "heron-blocked" : "heron-active";
    const one = plural.select(count) == "one";
    pill.textContent = blocked
      ? `🛡 ${t(one ? "trackersBlockedOne" : "trackersBlocked", String(count))}`
      : `⚠ ${t(one ? "trackersActiveOne" : "trackersActive", String(count))}`;
    pill.title = `${t(blocked ? "trackersBlockedTip" : "trackersActiveTip")}\n${hosts.join("\n")}`;
    header.append(pill);
  }

  if (!document.getElementById("heron-trackers-style")) {
    const style = document.createElement("style");
    style.id = "heron-trackers-style";
    style.textContent = `
      #heron-trackers {
        align-self: flex-start; margin: 2px 0 4px; padding: 2px 10px; border-radius: 999px;
        font-size: 0.85em; cursor: default; width: fit-content;
      }
      #heron-trackers.heron-blocked { color: #2f8f5b; background: color-mix(in srgb, #30a46c 14%, transparent); }
      #heron-trackers.heron-active { color: #b26b00; background: color-mix(in srgb, #f5a623 18%, transparent); }
    `;
    document.documentElement.append(style);
  }

  render();
  // The "remote content blocked" bar sometimes shows up just after: read the state again if the same message is still displayed (otherwise its document is gone).
  const later = () => {
    try {
      if (!heronStopped && document.getElementById("messagepane")?.contentDocument === content) {
        render();
      }
    } catch {
      // Message already replaced.
    }
  };
  setTimeout(later, 600);
  setTimeout(later, 1800);
  heronOnStop(() => {
    header.querySelector("#heron-trackers")?.remove();
    document.getElementById("heron-trackers-style")?.remove();
  });
})();
