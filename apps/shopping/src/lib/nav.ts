// In-app navigation. Each view is its own page, so leaving one is a real page load.

const FLASH_KEY = 'spesa:flash';

let navigating = false;

// True once the app itself started a page change: hiding the page is then not the app
// going to the background.
export function isNavigating(): boolean {
  return navigating;
}

export function goTo(url: string) {
  navigating = true;
  location.assign(url);
}

export function listUrl(listId: string): string {
  return `/lista/?id=${encodeURIComponent(listId)}`;
}

// Back to the home page, through history when the app came from there.
export function goHome() {
  navigating = true;
  const cameFromApp = document.referrer.startsWith(location.origin) && history.length > 1;
  if (cameFromApp) history.back();
  else location.replace('/');
}

// A toast message to show on the next page.
export function setFlash(message: string) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // The message is a courtesy; losing it is harmless.
  }
}

export function takeFlash(): string | null {
  try {
    const message = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return message;
  } catch {
    return null;
  }
}

// A page restored from the back-forward cache has a closed realtime connection and old data.
addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
