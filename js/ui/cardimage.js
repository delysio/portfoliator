// Card images that are not FAT12 disks: raw ROM, such as a DIP ROM extension.
//
// A card image is normally a whole card - 32, 64, 128 or 256 KB, or EPROM banks
// of 128 KB each. A raw ROM is often shorter: the extension in the Atari
// technical handbook is a few hundred bytes. Burnt into an EPROM it sits at the
// start of the chip and the rest of the chip stays erased, which reads as FFh;
// a chip smaller than the 128 KB window repeats itself every chip size. So a
// short image is padded with FFh up to the size of the chip it would go into,
// and the card window takes care of the repeating, as it does for any small card.
//
// Left alone, a short image would repeat every image length instead - every
// 513 bytes for a 513-byte file - which no hardware does.

const ERASED = 0xFF;
const SMALLEST_CARD = 32 * 1024;
const BANK = 128 * 1024;

/** The size a card image occupies on real hardware. */
export function cardSizeFor(length) {
  if (length <= BANK) {
    let size = SMALLEST_CARD;
    while (size < length) size *= 2;
    return size;
  }
  // Past one window the card is paged in 128 KB banks.
  return Math.ceil(length / BANK) * BANK;
}

/**
 * @param {Uint8Array} image
 * @returns {{image: Uint8Array, padded: boolean}} the image at its card size,
 *   with erased bytes after the end; the same array when nothing was missing
 */
export function padCardImage(image) {
  const size = cardSizeFor(image.length);
  if (!image.length || size === image.length) return { image, padded: false };
  const out = new Uint8Array(size).fill(ERASED);
  out.set(image);
  return { image: out, padded: true };
}

// The word at offset 0 that makes the BIOS run a card as a ROM extension.
const SIGNATURES = new Map([
  [0xAA55, 'AA55h'],
  [0x55AA, '55AAh'],
  [0x5555, '5555h'],
]);

/** 'AA55h', '55AAh' or '5555h' when the card starts as a ROM extension, else null. */
export function romSignature(image) {
  if (image.length < 2) return null;
  return SIGNATURES.get(image[0] | (image[1] << 8)) ?? null;
}
