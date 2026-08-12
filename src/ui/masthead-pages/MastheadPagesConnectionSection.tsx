import type { MastheadPagesConnectionState } from "../../app/desktopBridge";
import { AppButton } from "../primitives/AppButton";
import { SettingsSection } from "../settings/SettingsSection";
import { MastheadPagesStatus } from "./MastheadPagesStatus";

type Props = {
  connection?: MastheadPagesConnectionState;
  busy?: boolean;
  error?: string;
  desktopAvailable?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRefresh?: () => void;
};

export function MastheadPagesConnectionSection({
  busy = false,
  connection,
  desktopAvailable = true,
  error,
  onConnect,
  onDisconnect,
  onRefresh
}: Props) {
  const connected = connection?.status === "connected";
  return (
    <SettingsSection
      className="masthead-pages-connection-section"
      description="Connect a publisher account with OS-backed credentials. Local Logbook Pages stay private until you confirm Publish to Masthead Pages."
      eyebrow="Masthead Pages"
      title="Publish destination"
    >
      <MastheadPagesStatus connection={connection} error={error} />
      <div className="masthead-pages-connection-actions">
        {!desktopAvailable ? (
          <p className="surface-status">Masthead Pages connection is available in the desktop app only.</p>
        ) : connected ? (
          <>
            <AppButton disabled={busy} onClick={onRefresh} variant="quiet">
              Refresh connection
            </AppButton>
            <AppButton disabled={busy} onClick={onDisconnect} variant="quiet">
              Disconnect Masthead Pages
            </AppButton>
          </>
        ) : (
          <AppButton disabled={busy} onClick={onConnect} variant="primary">
            Connect Masthead Pages
          </AppButton>
        )}
      </div>
    </SettingsSection>
  );
}
