/* heron: shared helpers, loaded before each module in its sandbox (api/implementation.js).
 *
 * Everything a module sets up through these helpers is undone by heronStop(), called when the module is disabled in the options, or when heron is disabled or updated:
 *   heronListen(target, type, fn, options): listener, removed on stop;
 *   heronWrap(object, name, original => replacement): function wrapper, disarmed on stop;
 *   heronOnStop(fn): any other cleanup (added elements, observers...);
 *   heronStopped: true once the module is stopped (for timers still pending).
 */
/* exported heronOnStop, heronListen, heronWrap, heronStop */
var heronStops = [];
var heronStopped = false;

function heronOnStop(fn) {
  heronStops.push(fn);
}

function heronListen(target, type, fn, options) {
  target.addEventListener(type, fn, options);
  heronStops.push(() => target.removeEventListener(type, fn, options));
}

/**
 * Replaces object[name] with make(original). On stop, the original comes back; if another module wrapped the function in the meantime, our wrapper becomes transparent (it calls the original).
 */
function heronWrap(object, name, make) {
  const original = object[name];
  const wrapped = make(original);
  let active = true;
  const wrapper = function (...args) {
    return active ? wrapped.apply(this, args) : original.apply(this, args);
  };
  object[name] = wrapper;
  heronStops.push(() => {
    active = false;
    if (object[name] === wrapper) {
      object[name] = original;
    }
  });
  return original;
}

/** Undoes everything, in reverse order of setup. */
function heronStop() {
  heronStopped = true;
  while (heronStops.length) {
    try {
      heronStops.pop()();
    } catch (e) {
      console.error("heron: stop", e);
    }
  }
}
