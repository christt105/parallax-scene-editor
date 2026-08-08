// Tiny DOM helpers. No framework: the editor is a handful of panels and a
// canvas, and a build step would be a worse trade than a few lines of this.

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

/** h('div.row', { onclick }, [child, 'text']) */
export function h(spec, props = {}, children = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const [tag, id] = tagPart.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** A labelled control, the unit every inspector row is built from. */
export function field(label, control, hint) {
  return h('label.field', {}, [
    h('span.field-label', { text: label }),
    control,
    hint ? h('span.field-hint', { text: hint }) : null,
  ]);
}

export function select(options, value, onchange) {
  const node = h('select', { onchange: e => onchange(e.target.value) },
    options.map(o => {
      const [v, text] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, text, selected: String(v) === String(value) });
    }));
  node.value = value;
  return node;
}

export function number(value, onchange, attrs = {}) {
  return h('input', {
    type: 'number', value, ...attrs,
    oninput: e => { if (e.target.value !== '') onchange(+e.target.value); },
  });
}

export function toggle(value, onchange, label) {
  return h('label.toggle', {}, [
    h('input', { type: 'checkbox', checked: !!value, onchange: e => onchange(e.target.checked) }),
    h('span', { text: label || '' }),
  ]);
}

export function button(text, onclick, cls = '') {
  return h('button' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', onclick, text });
}

/** Position an element without letting it fall off the viewport. */
export function place(node, x, y) {
  node.style.left = '0px';
  node.style.top = '0px';
  const r = node.getBoundingClientRect();
  node.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  node.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
}
