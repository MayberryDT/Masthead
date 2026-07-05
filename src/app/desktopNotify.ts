import { invokeDesktopCommand } from "./desktopBridge";

export async function notifySessionEndedDesktop(input: { title: string; body?: string }): Promise<void> {
  await invokeDesktopCommand("notify_session_ended_command", input);
}
