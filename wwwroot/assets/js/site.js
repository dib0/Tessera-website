/* Progressive enhancement for the Tessera website. Every page works without this file.
   Served from this site (script-src 'self'): no inline script, no external code. */
(function () {
  'use strict';

  /* ---------- Tessera syntax highlighting ---------- */
  var KEYWORDS = new Set(['fn', 'type', 'enum', 'let', 'var', 'set', 'if', 'else', 'match', 'for', 'in', 'while', 'return',
    'break', 'continue', 'note', 'uses', 'and', 'or', 'not', 'true', 'false', 'import', 'pub', 'with', 'try', 'test']);

  function tokenize(source) {
    var out = [];
    var i = 0;
    var n = source.length;
    var afterUses = false;
    function push(kind, text) { out.push({ kind: kind, text: text }); }
    while (i < n) {
      var c = source[i];
      var j;
      if (c === '/' && source[i + 1] === '/') {
        j = source.indexOf('\n', i);
        if (j < 0) j = n;
        push('c', source.slice(i, j));
        i = j;
        continue;
      }
      if (c === '"') {
        j = i + 1;
        while (j < n && source[j] !== '"' && source[j] !== '\n') {
          if (source[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, n);
        push('s', source.slice(i, j));
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        j = i;
        while (j < n && /[0-9_.]/.test(source[j])) j++;
        push('n', source.slice(i, j));
        i = j;
        continue;
      }
      if (c === '.' && /[A-Z]/.test(source[i + 1] || '')) {
        j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
        push('v', source.slice(i, j));
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        j = i;
        while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++;
        var word = source.slice(i, j);
        if (KEYWORDS.has(word)) {
          afterUses = word === 'uses';
          push('k', word);
        } else if (afterUses) {
          push('e', word);
        } else if (/^[A-Z]/.test(word)) {
          push('t', word);
        } else {
          push('', word);
        }
        i = j;
        continue;
      }
      if (c === '{' || c === '=' || c === '\n') afterUses = false;
      push('', c);
      i++;
    }
    return out;
  }

  function highlight(code) {
    var tokens = tokenize(code.textContent);
    code.textContent = '';
    var plain = '';
    function flush() {
      if (plain) code.appendChild(document.createTextNode(plain));
      plain = '';
    }
    tokens.forEach(function (token) {
      if (!token.kind) { plain += token.text; return; }
      flush();
      var span = document.createElement('span');
      span.className = 'tok-' + token.kind;
      span.textContent = token.text;
      code.appendChild(span);
    });
    flush();
  }

  /* ---------- code blocks: highlighting and a copy button ---------- */
  function enhanceCode() {
    document.querySelectorAll('figure.code').forEach(function (figure) {
      var code = figure.querySelector('pre code');
      if (!code) return;
      var caption = figure.querySelector('figcaption');
      var name = caption ? caption.textContent.trim() : '';
      var original = code.textContent;
      if (/\.tes$/.test(name)) highlight(code);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'Copy';
      button.addEventListener('click', function () {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(original).then(function () {
          button.textContent = 'Copied';
          setTimeout(function () { button.textContent = 'Copy'; }, 1600);
        });
      });
      figure.appendChild(button);
    });
  }

  /* ---------- theme toggle and mobile menu ---------- */
  function currentTheme() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function enhanceHeader() {
    var bar = document.querySelector('header.site .bar');
    var nav = document.querySelector('nav.main');
    if (!bar || !nav) return;

    var theme = document.createElement('button');
    theme.type = 'button';
    theme.className = 'icon-btn';
    function paint() {
      var dark = currentTheme() === 'dark';
      theme.textContent = dark ? '☀' : '☾';
      theme.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
    }
    theme.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('tessera-theme', next); } catch (e) { /* ignore */ }
      paint();
    });
    paint();
    nav.appendChild(theme);

    var menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'icon-btn menu-btn';
    menu.textContent = '☰';
    menu.setAttribute('aria-label', 'Menu');
    menu.setAttribute('aria-expanded', 'false');
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    bar.insertBefore(menu, nav);
  }

  /* ---------- reveal on scroll ---------- */
  function enhanceReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- the tile T follows the pointer ---------- */
  function enhanceTilt() {
    var hero = document.querySelector('.hero');
    var tiles = document.querySelector('.tiles');
    if (!hero || !tiles) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    hero.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      var box = hero.getBoundingClientRect();
      var x = (event.clientX - box.left) / box.width - 0.5;
      var y = (event.clientY - box.top) / box.height - 0.5;
      tiles.style.setProperty('--ry', (x * 22).toFixed(1) + 'deg');
      tiles.style.setProperty('--rx', (-y * 18).toFixed(1) + 'deg');
    });
    hero.addEventListener('pointerleave', function () {
      tiles.style.setProperty('--ry', '0deg');
      tiles.style.setProperty('--rx', '0deg');
    });
  }

  /* ---------- admin: ask before deleting ---------- */
  function enhanceConfirm() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-confirm]');
      if (button && !window.confirm(button.getAttribute('data-confirm'))) event.preventDefault();
    });
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    var start = function () {
      enhanceConfirm();
      enhanceHeader();
      enhanceCode();
      enhanceReveal();
      enhanceTilt();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  if (typeof module !== 'undefined') module.exports = { tokenize: tokenize };
})();
