export function clearUnsupportedLocationHash(): boolean {
  if (!window.location.hash) return false;

  const nextUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, document.title, nextUrl || "/");
  return true;
}
