// Measures a swipe: 30 horizontal scroll events on row 3, then the action.
const a = window.gTabmail.currentAbout3Pane;
const wu = a.windowUtils;
const wait = ms => new Promise(r => setTimeout(r, ms));
let loads = 0;
const onLoad = () => loads++;
a.document.addEventListener("MsgLoaded", onLoad, true);
a.threadTree.scrollToIndex(0); // a previous test may have scrolled the list
await wait(300);
const row = a.threadTree.getRowAtIndex(3);
const rc = row.getBoundingClientRect();
const selBefore = a.threadTree.selectedIndex;
const r0 = wu.framesReflowed, c0 = wu.framesConstructed;
let handlerMs = 0;
for (let i = 0; i < 30; i++) {
  const t = performance.now();
  wu.sendWheelEvent(rc.left + rc.width / 2, rc.top + rc.height / 2, 8, 0, 0, 0, 0, 0, 0, 0);
  handlerMs += performance.now() - t;
  await new Promise(r => a.requestAnimationFrame(r));
}
const reflowsDuring = wu.framesReflowed - r0, constructedDuring = wu.framesConstructed - c0;
await wait(1500);
a.document.removeEventListener("MsgLoaded", onLoad, true);
const out = {
  reflowsDuringGesture: reflowsDuring,
  framesConstructed: constructedDuring,
  msPerEvent: +(handlerMs / 30).toFixed(2),
  messagesLoadedByAction: loads,
  selectionBefore: selBefore,
  selectionAfter: a.threadTree.selectedIndex,
  toast: a.document.getElementById("heron-toast")?.textContent ?? null,
};
a.document.querySelector("#heron-toast button")?.click();
await wait(1500);
return out;
