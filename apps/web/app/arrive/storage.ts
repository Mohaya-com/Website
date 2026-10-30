/** The status token of the visitor's latest arrival request, kept on this device so the page can be reopened. */
const KEY = 'vms_arrival_token';

export function saveArrivalToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // storage unavailable (private mode): the token stays in the page URL
  }
}

export function loadArrivalToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearArrivalToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
