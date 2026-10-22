// Tests swipe physics: gestures simulated at a controlled speed (real wheel events).
const a = window.gTabmail.currentAbout3Pane;
const wu = a.windowUtils;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Visible rows only (the list also keeps off-screen rows, above and below).
const rows = () => {
  const list = a.threadTree.getBoundingClientRect();
  return [...a.document.querySelectorAll("#threadTree tr.card-layout")].filter(row => {
    const r = row.getBoundingClientRect();
    return r.top >= list.top && r.bottom <= list.bottom;
  });
};
const count = () => a.gDBView.rowCount;

/** Sends events of `step` px every `every` ms; `steps` is a list of steps. */
async function gesture(rowIndex, steps, every) {
  const row = rows()[rowIndex];
  const r = row.getBoundingClientRect();
  for (const step of steps) {
    wu.sendWheelEvent(r.left + r.width / 2, r.top + r.height / 2, step, 0, 0, 0, 0, 0, 0, 0);
    await wait(every);
  }
}
const repeat = (step, n) => Array(n).fill(step);

/** Runs a gesture, reports whether the action happened, then undoes it to keep the same data. */
async function scenario(steps, every) {
  const before = count();
  await gesture(3, steps, every);
  await wait(900);
  const acted = count() < before;
  if (acted) {
    a.document.querySelector("#heron-toast button")?.click();
    await wait(1500);
  }
  await wait(500); // end of the rest period after a gesture
  return acted;
}

// A previous test may have scrolled the list: go back to the top.
a.threadTree.scrollToIndex(0);
await wait(300);

const width = rows()[3].getBoundingClientRect().width;
const out = { width: Math.round(width), threshold: Math.round(Math.min(150, width * 0.3)) };
await scenario(repeat(3, 10), 20); // warm-up: right after startup, timers are slow
out.slowBelowThreshold = await scenario(repeat(3, 30), 20); // 90 px, ~0.15 px/ms
out.slowPastThreshold = await scenario(repeat(3, 70), 20); // 210 px
out.fastAndShort = await scenario(repeat(20, 4), 12); // 80 px, ~1.6 px/ms
out.pastThenBack = await scenario([...repeat(4, 50), ...repeat(-6, 12)], 16); // 200 px then back

// Elastic resistance: sample the state in the middle of a long gesture (during the gesture, not after: on a busy machine, the gesture may complete before the loop ends).
{
  const before = count();
  const row = rows()[3];
  const r = row.getBoundingClientRect();
  let r0 = 0;
  for (let i = 0; i < 60; i++) {
    wu.sendWheelEvent(r.left + r.width / 2, r.top + r.height / 2, 4, 0, 0, 0, 0, 0, 0, 0);
    await new Promise(res => a.requestAnimationFrame(res));
    if (i == 2) {
      r0 = wu.framesReflowed; // setting up the band (first two frames) is excluded
    }
    if (i == 58) {
      const transform = row.querySelector(".card-container").style.transform;
      out.elastic = { fingers: 240, card: Math.abs(parseFloat(/translate3d\((-?[\d.]+)px/.exec(transform)?.[1] ?? "0")) };
      out.reflowsDuringGesture = wu.framesReflowed - r0;
      out.labelArmed = row.querySelector(".heron-band")?.hasAttribute("data-armed") ?? false;
      const icon = row.querySelector(".heron-icon");
      out.icon = icon ? a.getComputedStyle(icon).backgroundImage.slice(0, 40) : null;
    }
  }
  await wait(1200);
  if (count() < before) {
    a.document.querySelector("#heron-toast button")?.click();
    await wait(1500);
  }
}
return out;
