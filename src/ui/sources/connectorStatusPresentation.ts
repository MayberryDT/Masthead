import type { ConnectorActionRequired, HarnessConnectorDto } from "../../shared/harnessConnectors";

export type ConnectorStatusPresentation = {
  detail?: string;
  failed: boolean;
  passed: boolean;
  summary?: string;
  tone: "neutral" | "pass" | "fail" | "warn";
};

const HOST_ACTIVATION_ACTIONS = new Set<ConnectorActionRequired>([
  "trust_hooks",
  "enable_plugin",
  "login",
  "restart_host",
  "confirm_activation"
]);

export function isHostActivationAction(action: ConnectorActionRequired | undefined): boolean {
  return Boolean(action && HOST_ACTIVATION_ACTIONS.has(action));
}

export function pendingActionTestCopy(action: ConnectorActionRequired | undefined): string {
  if (action === "trust_hooks") return "Endpoint test passed — trust hooks still required";
  if (action === "enable_plugin") return "Endpoint test passed — plugin enablement still required";
  if (action === "login") return "Endpoint test passed — host login still required";
  if (action === "restart_host") return "Endpoint test passed — host restart still required";
  if (action === "confirm_activation") return "Endpoint test passed — activation confirmation still required";
  if (action === "repair") return "Endpoint test passed — connector repair still required";
  return "Endpoint test passed — live capture still needs action";
}

export function connectorStatusPresentation(
  connector: HarnessConnectorDto,
  actionStatus?: string
): ConnectorStatusPresentation {
  const testedStatus = connector.lastTest?.status;
  const failed = testedStatus === "failed" || (testedStatus === undefined && isFailedActionStatus(actionStatus));
  const passed = testedStatus === "passed" || (testedStatus === undefined && isPassedActionStatus(actionStatus));

  if (failed || connector.live === "error") {
    const summary = actionStatus?.trim() || (connector.lastTest?.status === "failed" ? "Endpoint test failed" : connector.actionMessage);
    return { detail: summary, failed: true, passed: false, summary, tone: "fail" };
  }

  if (connector.live === "needs_action" && passed) {
    const summary = pendingActionTestCopy(connector.actionRequired);
    const detail = connector.actionMessage ? `${summary}. ${connector.actionMessage}` : summary;
    return { detail, failed: false, passed: true, summary, tone: "warn" };
  }

  if (actionStatus?.trim()) {
    const summary = actionStatus.trim();
    return { detail: summary, failed: false, passed, summary, tone: passed ? "pass" : "neutral" };
  }

  if (connector.actionMessage && connector.live === "needs_action") {
    return { detail: connector.actionMessage, failed: false, passed: false, summary: connector.actionMessage, tone: "warn" };
  }

  if (connector.presence === "not_found") {
    const summary = connector.live === "not_installed"
      ? "Harness not found on this machine."
      : "Harness not found on this machine. Live wiring may still exist from a previous install.";
    return { detail: summary, failed: false, passed: false, summary, tone: "warn" };
  }

  if (connector.lastTest?.status === "passed") {
    return { detail: `Endpoint test passed — ${connector.lastTest.message}`, failed: false, passed: true, summary: "Endpoint test passed", tone: "pass" };
  }
  if (connector.live === "ready") {
    return { detail: "Live capture is ready for this harness.", failed: false, passed: false, tone: "neutral" };
  }
  return { failed: false, passed: false, tone: "neutral" };
}

function isFailedActionStatus(actionStatus: string | undefined): boolean {
  const status = actionStatus?.trim();
  return Boolean(status && ["Test failed", "Enable failed", "Uninstall failed", "Confirm failed"].some((prefix) => status.startsWith(prefix)));
}

function isPassedActionStatus(actionStatus: string | undefined): boolean {
  const status = actionStatus?.trim();
  return Boolean(status && ["Endpoint test passed", "Test passed", "Enabled — ready", "Activation confirmed — ready"].some((prefix) => status.startsWith(prefix)));
}
