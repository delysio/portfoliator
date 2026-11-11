// Cache busting, so a reload always runs the code that is on disk.
//
// The obvious approach - hanging ?ver= on the entry points - only half works
// with ES modules, and the half that fails is silent, which is worse than not
// doing it at all:
//
//   * a query is NOT inherited by static imports. `./emu/keyboard.js` resolved
//     against `main.js?ver=9` is plain `keyboard.js`, so the entry point comes
//     back fresh while the modules doing the actual work stay stale;
//   * a module worker gets its own module graph and ignores the document's
//     import map, so there is no declarative way to stamp its imports either.
//
// So the version stamp is only half the job. The other half walks the import
// graph from the entry points and re-fetches every module with cache:'reload',
// which replaces the HTTP cache entry rather than reading it. The import() that
// follows - and the worker, which shares the same HTTP cache - then load the
// fresh copies through their normal, unstamped URLs.
//
// This is a development convenience. On a real deployment the same result comes
// from one Cache-Control header, and this file can go.

(function () {
  'use strict';

  // The page names its entry point; the emulator's is the default, and it is
  // the one page with a worker whose module graph needs refreshing too.
  const script = document.currentScript;
  const ENTRY = (script && script.dataset.entry) || 'js/main.js';
  const ROOTS = ENTRY === 'js/main.js' ? [ENTRY, 'js/emu/worker.js'] : [ENTRY];

  const stamp = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const VER = `${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}` +
              `-${p(stamp.getHours())}${p(stamp.getMinutes())}${p(stamp.getSeconds())}`;

  // Exposed so the emulator can stamp what it loads at runtime (the worker, the
  // case artwork) with the same value.
  window.APP_VERSION = VER;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `css/app.css?ver=${VER}`;
  document.head.appendChild(link);

  // Matches the single-line `import ... from '...'` and `export ... from '...'`
  // forms this project uses, plus dynamic import('...') with a literal path.
  const FROM_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
  const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  const visited = new Set();
  let refreshed = 0;

  async function refresh(url) {
    if (visited.has(url)) return;
    visited.add(url);

    let source;
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) return;
      source = await res.text();
      refreshed++;
    } catch {
      return;                       // a missing module is the loader's problem
    }

    const pending = [];
    for (const re of [FROM_RE, DYNAMIC_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(source)) !== null) {
        const spec = m[1];
        if (spec[0] !== '.' && spec[0] !== '/') continue;   // bare = not ours
        pending.push(refresh(new URL(spec, url).href));
      }
    }
    await Promise.all(pending);
  }

  const entry = (path) => new URL(path, document.baseURI).href;

  Promise.all(ROOTS.map((r) => refresh(entry(r)))).then(() => {
    console.info(`Portfoliator ${VER} — odświeżono ${refreshed} modułów`);
    return import(`${entry(ENTRY)}?ver=${VER}`);
  }).catch((err) => {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = `błąd ładowania: ${err.message}`;
      status.className = 'err';
    }
    console.error(err);
  });
})();
