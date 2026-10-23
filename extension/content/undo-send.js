/* heron: undo send, main window side (module "undoSend").
 *
 * Run by api/implementation.js in a sandbox whose prototype is the main window.
 * The compose window (undo-send-compose.js) queues the message in the Outbox and notifies this side. We show "Sending in N s, Undo":
 * - with no action, the Outbox is sent when the delay ends;
 * - "Undo" reopens the message in the compose window and removes it from the Outbox.
 * If Thunderbird quits before the delay ends, the message stays in the Outbox: Thunderbird will offer to send it (normal "Send Later" behavior).
 */
(() => {
  if (window.__heronUndoSendMain) {
    return;
  }
  window.__heronUndoSendMain = true;
  heronOnStop(() => delete window.__heronUndoSendMain);

  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);

  /** Send announced by a compose window, waiting for the message to reach the Outbox. */
  let announced = null; // { identity, seconds, subject, at }
  /** Pending sends: { hdr, identity, until, timer }. */
  const jobs = new Set();

  // Only one main window listens (if several are open, the first one is enough).
  if ([...Services.wm.getEnumerator("mail:3pane")].some(w => w != window && w.__heronUndoSendMain)) {
    return;
  }

  const observer = {
    observe(subject, topic, data) {
      announced = { ...JSON.parse(data), at: Date.now() };
    },
  };
  Services.obs.addObserver(observer, "heron-send-held");

  const folderListener = {
    msgAdded(hdr) {
      if (!announced || !(hdr.folder.flags & Ci.nsMsgFolderFlags.Queue) || Date.now() - announced.at > 60000) {
        return;
      }
      const job = { ...announced, hdr };
      announced = null;
      start(job);
    },
  };
  MailServices.mfn.addListener(folderListener, Ci.nsIMsgFolderNotificationService.msgAdded);
  let attached = true;
  function detach() {
    if (attached) {
      attached = false;
      Services.obs.removeObserver(observer, "heron-send-held");
      MailServices.mfn.removeListener(folderListener);
    }
  }
  heronListen(window, "unload", detach);

  // --- Send or undo ------------------------------------------------------------------------

  function identityOf(job) {
    return (job.identity && MailServices.accounts.getIdentity(job.identity)) ||
      MailServices.accounts.defaultAccount?.defaultIdentity;
  }

  function start(job) {
    job.until = Date.now() + job.seconds * 1000;
    job.timer = setTimeout(() => send(job), job.seconds * 1000);
    jobs.add(job);
    render();
  }

  function send(job) {
    if (!jobs.has(job)) {
      return;
    }
    jobs.delete(job);
    clearTimeout(job.timer);
    render();
    const sendLater = Cc["@mozilla.org/messengercompose/sendlater;1"].getService(Ci.nsIMsgSendLater);
    sendLater.sendUnsentMessages(identityOf(job));
  }

  /** Opens `hdr` in a compose window, as a draft. */
  function reopen(hdr, job) {
    MailServices.compose.OpenComposeWindow(
      null,
      hdr,
      hdr.folder.getUriForMsg(hdr),
      Ci.nsIMsgCompType.Draft,
      Ci.nsIMsgCompFormat.Default,
      identityOf(job),
      null,
      top.msgWindow
    );
  }

  /**
   * Undo: the message first leaves the Outbox for the local Drafts folder, then reopens from there. Whatever happens next (slow or failed compose window, Thunderbird quitting), an undone message can no longer be sent: at worst it waits in Drafts.
   */
  function undo(job) {
    jobs.delete(job);
    clearTimeout(job.timer);
    render();
    const hdr = job.hdr;
    const drafts = MailServices.accounts.localFoldersServer?.rootFolder?.getFolderWithFlags(Ci.nsMsgFolderFlags.Drafts);
    if (!drafts) {
      // No local Drafts folder (unusual): reopen from the Outbox, then remove it there once the window is ready.
      undoInPlace(job);
      return;
    }
    // Found again by its Message-ID: a move between local folders does not always report the new key.
    const messageId = hdr.messageId;
    const findMoved = () => [...drafts.messages].find(h => h.messageId == messageId) ?? null;
    const onStopCopy = status => {
      const moved = Components.isSuccessCode(status) ? findMoved() : null;
      if (moved) {
        reopen(moved, job);
      } else {
        console.error("heron: undo send, could not move the message to Drafts", status);
        undoInPlace(job);
      }
    };
    // nsIMsgCopyServiceListener (lowercase method names since Thunderbird 128).
    MailServices.copy.copyMessages(hdr.folder, [hdr], drafts, true, {
      onStartCopy() {},
      onProgress() {},
      setMessageKey() {},
      getMessageId() {},
      onStopCopy,
    }, null, false);
  }

  /** Fallback: reopen from the Outbox, and remove it there once the compose window has read it. */
  function undoInPlace(job) {
    const hdr = job.hdr;
    const before = new Set(Services.wm.getEnumerator("msgcompose"));
    reopen(hdr, job);
    const started = Date.now();
    const wait = setInterval(() => {
      const opened = [...Services.wm.getEnumerator("msgcompose")].find(w => !before.has(w));
      const ready = opened?.gMsgCompose?.editor && opened.document.readyState == "complete";
      if (ready || Date.now() - started > 15000) {
        clearInterval(wait);
        // Removed even if the window never got ready: an undone message must not stay where it would be sent. Without a reopened copy, it goes to the Trash (recoverable) rather than being erased.
        setTimeout(() => {
          try {
            hdr.folder.deleteMessages([hdr], null, Boolean(ready), false, null, false);
          } catch (e) {
            console.error("heron: undo send", e);
          }
        }, ready ? 1000 : 0);
      }
    }, 250);
  }

  // --- Notification -------------------------------------------------------------------------

  const style = document.createElement("style");
  style.textContent = `
    #heron-undo-send {
      position: fixed; z-index: 20; left: 50%; bottom: 22px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 14px; padding: 9px 10px 9px 16px;
      border-radius: 12px; background: #2b2b2e; color: #fff; font: menu; font-size: 13px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28); overflow: hidden;
    }
    #heron-undo-send[hidden] { display: none; }
    #heron-undo-send button {
      all: unset; cursor: pointer; padding: 4px 12px; border-radius: 8px; font-weight: 600;
      background: rgba(255, 255, 255, 0.16);
    }
    #heron-undo-send button:hover { background: rgba(255, 255, 255, 0.28); }
    #heron-undo-send .heron-progress {
      position: absolute; left: 0; bottom: 0; height: 3px; background: AccentColor;
      transform-origin: left; animation: heron-undo-progress linear forwards;
    }
    @keyframes heron-undo-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  `;
  document.documentElement.append(style);

  const toast = document.createElement("div");
  toast.id = "heron-undo-send";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  const label = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("undoSendUndo");
  const progress = document.createElement("div");
  progress.className = "heron-progress";
  toast.append(label, button, progress);
  document.documentElement.append(toast);

  let ticker = null;
  function render() {
    const latest = [...jobs].at(-1);
    clearInterval(ticker);
    if (!latest) {
      toast.hidden = true;
      return;
    }
    toast.hidden = false;
    const update = () => {
      const left = Math.max(0, Math.ceil((latest.until - Date.now()) / 1000));
      label.textContent = t("undoSendCountdown", String(left));
    };
    update();
    ticker = setInterval(update, 250);
    // Progress bar: restart it for this message.
    progress.style.animation = "none";
    progress.offsetWidth; // restarts the animation
    progress.style.animation = "";
    progress.style.animationDuration = `${Math.max(0, latest.until - Date.now())}ms`;
    button.onclick = () => undo(latest);
  }

  // On stop (module disabled, heron disabled or updated): nobody will keep the delay anymore, so pending messages are sent right away. A message is never left behind in the Outbox.
  heronOnStop(() => {
    for (const job of [...jobs]) {
      send(job);
    }
    clearInterval(ticker);
    detach();
    toast.remove();
    style.remove();
  });
})();
