// Render free-tier services spin down when idle and take ~30-60s to wake up.
// We fire this once, as soon as the app mounts, so the backend is warm by
// the time the user finishes the questionnaire. Failures are ignored on
// purpose — this is a best-effort wake-up ping, not a real request.
const API_BASE_URL = import.meta.env.VITE_API_URL as string | undefined;

export function wakeBackend() {
  if (!API_BASE_URL) {
    console.warn("VITE_API_URL is not set — skipping backend wake-up ping.");
    return;
  }

  fetch(`${API_BASE_URL}/health`, { mode: "cors" }).catch(() => {
    // Cold start or backend not deployed yet — nothing to do here.
  });
}

