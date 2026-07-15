export function shouldHideWindowOnClose(input: { keepRunningInTray: boolean; quitting: boolean }): boolean {
  return input.keepRunningInTray && !input.quitting;
}
