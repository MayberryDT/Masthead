import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const RECOVERABLE_STATES = new Set([
  "snapshot_ready",
  "ready_to_activate",
  "restoring",
  "restore_failed",
  "restored"
]);

export async function runColdProductionActivation(context, dependencies) {
  const { config } = context;
  const lease = await dependencies.acquireLease();
  try {
    await dependencies.attestCandidate();
    const pending = await dependencies.readMaintenanceJournal();
    if (pending) {
      const request = validateColdReceipt(pending, config);
      await dependencies.assertLegacyIdentity(request.legacyTarget);
      assertRecoveryCurrent(await dependencies.currentTarget(), request);
      await dependencies.installDisabledSurface();
      await recoverOffline(request, dependencies);
      return {
        activated: false,
        coldActivated: true,
        recovered: true,
        target: request.legacyTarget.path
      };
    }

    const current = await dependencies.currentTarget();
    if (!current || current === config.target) {
      throw new Error("Cold activation requires a distinct existing legacy current target.");
    }
    const legacyTarget = await dependencies.captureLegacyIdentity(current);
    await dependencies.assertOffline();

    // This fail-closed surface is durable before maintenance can take minutes or
    // leave a journal. Neither the legacy nor candidate executable is reachable.
    await dependencies.installDisabledSurface();
    const request = {
      databasePath: config.databasePath,
      legacyTarget,
      newBundle: bundleIdentity(config),
      nonce: dependencies.createNonce ? dependencies.createNonce() : randomUUID(),
      rollbackMode: "offline_only"
    };

    let prepared;
    let started;
    try {
      prepared = validateReadyReceipt(await dependencies.prepareMaintenance(request), config);
      await dependencies.assertLegacyIdentity(legacyTarget);
      await dependencies.attestCandidate();
      await dependencies.swapCurrent();
      await dependencies.installCandidateSurface();
      await dependencies.attestCandidate();
      started = await dependencies.start({
        ...config,
        expectedDatabaseId: prepared.databaseId,
        expectedSchemaVersion: prepared.targetSchemaVersion,
        transitionNonce: prepared.nonce
      });
      await dependencies.attestCandidate();
      await dependencies.assertLegacyIdentity(legacyTarget);
      await dependencies.completeMaintenance(request);
    } catch (error) {
      try {
        await rollbackOffline(request, prepared, dependencies);
      } catch (rollbackError) {
        throw new Error(
          `${errorMessage(error)}; cold rollback failed: ${errorMessage(rollbackError)}; production remains disabled`,
          { cause: error }
        );
      }
      throw new Error(`${errorMessage(error)}; cold rollback offline=true`, { cause: error });
    }
    // Durable completion is the commit point. Bundle cleanup is success-only;
    // a cleanup error must not attempt an impossible journal-less rollback.
    await dependencies.cleanupBundles();
    return { activated: true, coldActivated: true, started, target: config.target };
  } finally {
    await lease.release();
  }
}

async function recoverOffline(request, dependencies) {
  await dependencies.stopMaintenance(request);
  await dependencies.stopCandidate();
  await dependencies.assertLegacyIdentity(request.legacyTarget);
  const restored = validateRestoredReceipt(await dependencies.restoreMaintenance(request), request);
  await dependencies.assertLegacyIdentity(request.legacyTarget);
  await dependencies.restoreCurrent(request.legacyTarget.path);
  await dependencies.assertOffline();
  await dependencies.completeMaintenance(restored);
}

async function rollbackOffline(request, prepared, dependencies) {
  await dependencies.installDisabledSurface();
  await dependencies.stopMaintenance(request);
  await dependencies.stopCandidate();
  const pending = await dependencies.readMaintenanceJournal();
  if (pending) {
    const authoritative = validateColdReceipt(pending, { ...request.newBundle, databasePath: request.databasePath });
    if (!sameLegacyIdentity(authoritative.legacyTarget, request.legacyTarget) || authoritative.nonce !== request.nonce) {
      throw new Error("Cold activation rollback journal does not match the attempted transition.");
    }
    await dependencies.assertLegacyIdentity(authoritative.legacyTarget);
    const restored = validateRestoredReceipt(await dependencies.restoreMaintenance(authoritative), authoritative);
    await dependencies.assertLegacyIdentity(authoritative.legacyTarget);
    await dependencies.restoreCurrent(authoritative.legacyTarget.path);
    await dependencies.assertOffline();
    await dependencies.completeMaintenance(restored);
    return;
  }
  if (prepared) throw new Error("Cold activation rollback journal disappeared after maintenance prepared successfully.");
  await dependencies.assertLegacyIdentity(request.legacyTarget);
  await dependencies.restoreCurrent(request.legacyTarget.path);
  await dependencies.assertOffline();
}

export function validateColdReceipt(receipt, config) {
  const expectedCandidate = bundleIdentity(config);
  if (
    receipt?.schemaVersion !== 2 || receipt.rollbackMode !== "offline_only" ||
    !RECOVERABLE_STATES.has(receipt.state) || "oldBundle" in receipt ||
    receipt.databasePath !== resolve(config.databasePath) ||
    typeof receipt.databaseId !== "string" || !receipt.databaseId ||
    !Number.isSafeInteger(receipt.sourceSchemaVersion) || receipt.sourceSchemaVersion < 0 ||
    !Number.isSafeInteger(receipt.targetSchemaVersion) || receipt.targetSchemaVersion < receipt.sourceSchemaVersion ||
    !validNonce(receipt.nonce) || !sameBundle(receipt.newBundle, expectedCandidate) ||
    !validLegacyIdentity(receipt.legacyTarget)
  ) {
    throw new Error("Cold activation journal does not match the candidate, database, or offline-only rollback boundary.");
  }
  return {
    databaseId: receipt.databaseId,
    databasePath: resolve(receipt.databasePath),
    legacyTarget: { ...receipt.legacyTarget, path: resolve(receipt.legacyTarget.path) },
    newBundle: receipt.newBundle,
    nonce: receipt.nonce,
    rollbackMode: "offline_only",
    schemaVersion: 2,
    sourceSchemaVersion: receipt.sourceSchemaVersion,
    state: receipt.state,
    targetSchemaVersion: receipt.targetSchemaVersion
  };
}

function validateReadyReceipt(receipt, config) {
  const validated = validateColdReceipt(receipt, config);
  if (validated.state !== "ready_to_activate") {
    throw new Error(`Cold activation maintenance was not ready to activate: ${validated.state}.`);
  }
  return validated;
}

function validateRestoredReceipt(receipt, request) {
  const validated = validateColdReceipt(receipt, { ...request.newBundle, databasePath: request.databasePath });
  if (
    validated.state !== "restored" || validated.nonce !== request.nonce ||
    validated.databaseId !== request.databaseId ||
    validated.sourceSchemaVersion !== request.sourceSchemaVersion ||
    !sameLegacyIdentity(validated.legacyTarget, request.legacyTarget)
  ) {
    throw new Error("Cold activation restore receipt does not match the authoritative journal.");
  }
  return validated;
}

function assertRecoveryCurrent(current, request) {
  if (current !== request.legacyTarget.path && current !== request.newBundle.target) {
    throw new Error("Cold activation recovery current target is neither the legacy nor candidate target.");
  }
}

function bundleIdentity(config) {
  return {
    bundleDigest: config.bundleDigest,
    gitSha: config.gitSha,
    target: config.target,
    version: config.version
  };
}

function sameBundle(left, right) {
  return Boolean(left && right && left.bundleDigest === right.bundleDigest && left.gitSha === right.gitSha &&
    resolve(left.target || "") === resolve(right.target || "") && left.version === right.version);
}

function validLegacyIdentity(identity) {
  return Boolean(identity && /^\d+$/u.test(identity.device) && /^\d+$/u.test(identity.inode) &&
    typeof identity.path === "string" && resolve(identity.path) === identity.path);
}

function sameLegacyIdentity(left, right) {
  return Boolean(left && right && left.path === right.path && left.device === right.device && left.inode === right.inode);
}

function validNonce(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value || "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
