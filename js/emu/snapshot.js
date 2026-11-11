// Machine state snapshots: the shared plumbing.
//
// Every device in js/emu/ carries a `snapshot()` that returns a plain object
// and a `restore(s)` that takes one back. The pieces here are the parts that
// would otherwise be copied into ten files: pulling a fixed list of fields out
// of an object, putting it back, and copying typed arrays so that a snapshot
// keeps its own memory rather than aliasing the machine's.
//
// Two rules hold everywhere, and both exist because of how the state gets used.
//
// **Only what the machine cannot recompute.** ROM images, callbacks, the bound
// bus object, decoder scratch that lives for one instruction - none of it goes
// in. A snapshot is restored into a machine built the same way, so anything the
// constructor sets up is already there. Putting it in the snapshot would not be
// harmless: a restored callback would point at the previous machine.
//
// **A field is either in the snapshot or deliberately out of it.** There is no
// third category, and `tools/tests/state.mjs` enforces exactly that - it walks
// the live objects field by field and demands that each one be accounted for.
// Adding a field to a device and forgetting it here is the failure this whole
// arrangement exists to make impossible, because the symptom otherwise is a
// restored machine that runs correctly for a while and then does not.

/** Snapshot format version. Bumped when the shape changes incompatibly. */
export const STATE_VERSION = 1;

/** Copies the named fields out of an object. */
export function take(obj, keys) {
  const s = {};
  for (const k of keys) s[k] = obj[k];
  return s;
}

/** Puts the named fields back, ignoring any the snapshot does not carry. */
export function put(obj, s, keys) {
  for (const k of keys) if (k in s) obj[k] = s[k];
}

/**
 * A copy of a typed array that owns its memory.
 *
 * `slice()` on its own would do, but a snapshot that crosses a worker boundary
 * comes back as a plain array or an ArrayBuffer depending on how it travelled,
 * so this normalises all three cases into the type the device expects.
 */
export function copyBytes(src, Ctor = Uint8Array) {
  if (!src) return null;
  if (ArrayBuffer.isView(src)) return new Ctor(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
  if (src instanceof ArrayBuffer) return new Ctor(src.slice(0));
  return Ctor.from(src);
}

/** Writes bytes into an existing array, leaving its length alone. */
export function intoBytes(dst, src) {
  if (!src) return;
  dst.set(ArrayBuffer.isView(src) ? src : new dst.constructor(src));
}

/**
 * A memory card as a snapshot carries it.
 *
 * The page register belongs here as much as the data does: a card larger than
 * the 128 KB window is halfway through a page whenever the ROM is reading
 * across the boundary, and a restore that reset it to zero would hand DIP-DOS
 * the wrong half of the volume.
 */
export function takeCard(card) {
  if (!card) return null;
  return { data: copyBytes(card.data), writable: !!card.writable,
           dirty: !!card.dirty, page: card.page | 0 };
}

export function putCard(s) {
  if (!s) return null;
  return { data: copyBytes(s.data), writable: !!s.writable,
           dirty: !!s.dirty, page: s.page | 0 };
}
