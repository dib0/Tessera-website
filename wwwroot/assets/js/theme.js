/* Runs in <head> before the page is painted: marks the page as script-enabled and applies a saved theme. */
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try {
    var saved = localStorage.getItem('tessera-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) { /* storage can be blocked; the system preference is used then */ }
})();
