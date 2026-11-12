// Tab switching: tapping a tab shows its screen and updates the big title.
const tabs = document.querySelectorAll('.tab');
const screens = document.querySelectorAll('.screen');
const title = document.getElementById('screen-title');

function show(name) {
  screens.forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  const current = document.getElementById('screen-' + name);
  title.textContent = current.dataset.title;
  document.querySelector('.screens').scrollTop = 0;
}

tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.screen)));

// Offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
