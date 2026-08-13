// The one dialog the whole editor borrows: a title, a body to fill, a close.

import { $, clear } from './dom.js';

export function openModal(title) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  clear(body);
  if (!dlg.open) dlg.showModal();
  return body;
}

export function closeModal() { $('#modal').close(); }
