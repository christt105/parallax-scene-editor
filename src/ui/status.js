// The line under the stage: one message at a time, written from anywhere.

import { $, clear } from './dom.js';

/**
 * The status line. `auto` marks messages the editor writes on its own (the
 * loop-cycle warnings), so they can be replaced freely without stepping on
 * something the user's own action just reported.
 */
let saidAt = 0;
export function say(msg, kind = '', auto = false) {
  const node = $('#status');
  clear(node);
  node.className = kind;
  node.dataset.auto = auto ? '1' : '0';
  if (!auto) saidAt = performance.now();
  node.append(typeof msg === 'string' ? document.createTextNode(msg) : msg);
}

/** How long the message the user's own action produced has been up, in ms. */
export const saidAgo = () => performance.now() - saidAt;
