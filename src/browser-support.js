// Why "Open folder…" might not get write access, browser by browser.
//
// The File System Access API is Chromium desktop only: Chrome, Edge and Opera
// have shipped it since v86. Brave ships the same engine but keeps the API
// behind a flag, off by default. Firefox and Safari never expose it, on
// desktop or mobile, in any version — they only have OPFS, a private sandbox
// that cannot see the user's real folders. So outside Chromium desktop (and
// Brave, once flipped), read-only is not a today-limitation, it is the ceiling.

/** 'ok' | 'brave' | 'none' — never re-detected, the answer cannot change mid-session. */
export async function detectFolderSupport() {
  if (typeof window.showDirectoryPicker === 'function') return 'ok';
  try {
    return (await navigator.brave?.isBrave?.()) ? 'brave' : 'none';
  } catch {
    return 'none';
  }
}

/** Pure text, so it can be checked without a browser to run it in. */
export function folderSupportTitle(support) {
  if (support === 'brave') {
    return 'Brave ships the File System Access API disabled by default — turn it on at ' +
      'brave://flags (search "File System") to write to disk here. Until then, folders ' +
      'load as a read-only snapshot; Download saves the JSON instead.';
  }
  if (support === 'none') {
    return 'This browser cannot write to disk — only desktop Chrome, Edge, Opera and ' +
      'Brave (behind a flag) support it. Folders load as a read-only snapshot; Download ' +
      'saves the JSON instead.';
  }
  return '';
}
