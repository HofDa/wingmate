const installButton = document.querySelector('#installApp');
const updateButton = document.querySelector('#updateApp');
const status = document.querySelector('#pwaStatus');
const hint = document.querySelector('#installHint');
let installPrompt = null;
let offlineReady = false;

function setStatus(label, description = label, kind = 'info') {
  status.textContent = label;
  status.title = description;
  status.setAttribute('aria-label', description);
  status.dataset.kind = kind;
}
function showStatus() {
  if (offlineReady) setStatus(navigator.onLine ? 'Offline bereit' : 'Offline · lokal nutzbar', undefined, 'ok');
  else if (navigator.onLine) setStatus('Offline vorbereiten', 'Offline-Nutzung wird vorbereitet …');
  else setStatus('Offline nicht bereit', 'Offline-Nutzung noch nicht vorbereitet. Bitte einmal online öffnen.', 'warn');
}
function showInstallHint() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  hint.hidden = !!installed;
  installButton.hidden = !!installed || !installPrompt;
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  showInstallHint();
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { hint.textContent = 'Zum Installieren bitte das Browsermenü verwenden.'; }
});
window.addEventListener('appinstalled', () => {
  installPrompt = null; installButton.hidden = true; hint.hidden = true;
});
showInstallHint();

if ('serviceWorker' in navigator && window.isSecureContext) {
  showStatus();
  window.addEventListener('online', showStatus);
  window.addEventListener('offline', showStatus);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First activation needs no reload. A user-approved update does.
    if (reloading) location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { updateViaCache: 'none' });
    function showUpdate() {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      updateButton.hidden = false;
      document.querySelector('#updateHint').hidden = false;
    }
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') showUpdate();
        if (worker.state === 'redundant' && !offlineReady) setStatus('Offline nicht bereit', 'Offline-Vorbereitung fehlgeschlagen. Bitte online neu laden.', 'warn');
      });
    });
    updateButton.addEventListener('click', () => {
      if (!registration.waiting) return;
      reloading = true;
      updateButton.disabled = true;
      registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
    });
    await navigator.serviceWorker.ready;
    offlineReady = true;
    showStatus();
  } catch {
    setStatus('Offline nicht bereit', 'Offline-Nutzung konnte nicht eingerichtet werden. Bitte online neu laden.', 'warn');
  }
} else {
  setStatus('Browser-Modus', 'Installation und Offline-Nutzung benötigen HTTPS oder localhost.');
}
