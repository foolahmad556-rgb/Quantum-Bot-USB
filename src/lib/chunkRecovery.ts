const KEY = 'quantum:chunk-recovery';
const COOLDOWN_MS = 5 * 60_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS/i.test(message);
}

/** One automatic navigation per cooldown, including when several imports fail together. */
export function recoverChunkLoad(
  error: unknown,
  browser: Pick<Window, 'sessionStorage' | 'location'> = window,
  now = Date.now(),
): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const previous = Number(browser.sessionStorage.getItem(KEY) || 0);
    if (previous && now - previous < COOLDOWN_MS) return false;
    browser.sessionStorage.setItem(KEY, String(now));
    const url = new URL(browser.location.href);
    url.searchParams.set('_ui_reload', String(now));
    browser.location.replace(url.href);
    return true;
  } catch {
    // With storage disabled, offer manual recovery instead of risking a reload loop.
    return false;
  }
}

export function reloadLatestPage(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('_ui_reload', String(Date.now()));
  window.location.replace(url.href);
}
