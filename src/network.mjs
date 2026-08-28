import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const NETWORK_MODES = new Set(['trusted', 'allowlist', 'deny']);
const DNS_HOSTNAME = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*$/u;

function normalizedHost(value) {
  if (typeof value !== 'string') {
    throw new Error(`security.network.allowHosts contains an invalid allowlist host: ${JSON.stringify(value)}.`);
  }
  const raw = value.trim().toLowerCase();
  if (/[\u0000-\u0020\u007f/\\?#@;]/u.test(raw)) {
    throw new Error(`security.network.allowHosts contains an invalid allowlist host: ${JSON.stringify(value)}.`);
  }
  const bracketed = raw.match(/^\[([^\]]+)\]$/u);
  const ipv6 = bracketed?.[1] ?? raw;
  if (isIP(ipv6) === 6) return new URL(`http://[${ipv6}]`).hostname.toLowerCase();
  if (bracketed || raw.includes(':')) {
    throw new Error(`security.network.allowHosts contains an invalid allowlist host: ${JSON.stringify(value)}.`);
  }
  if (isIP(raw) === 4) return raw;

  const ascii = domainToASCII(raw).toLowerCase();
  if (!ascii || ascii.length > 253 || !DNS_HOSTNAME.test(ascii)) {
    throw new Error(`security.network.allowHosts contains an invalid allowlist host: ${JSON.stringify(value)}.`);
  }
  return new URL(`http://${ascii}`).hostname.toLowerCase();
}

export function normalizeNetworkPolicy(value = 'trusted', fallbackHosts = []) {
  const policy = typeof value === 'string'
    ? { mode: value, allowHosts: fallbackHosts }
    : { mode: value?.mode ?? 'trusted', allowHosts: value?.allowHosts ?? fallbackHosts };
  if (!NETWORK_MODES.has(policy.mode)) {
    throw new Error(`security.network must be trusted, allowlist, or deny; received ${policy.mode}.`);
  }
  if (!Array.isArray(policy.allowHosts)) {
    throw new Error('security.network.allowHosts must be an array.');
  }
  return {
    mode: policy.mode,
    allowHosts: [...new Set(policy.allowHosts.map(normalizedHost))],
  };
}

function parsedUrl(value) {
  try {
    return String(value).startsWith('//') ? new URL(`https:${value}`) : new URL(value);
  } catch {
    return null;
  }
}

export function isRemoteUrl(value) {
  const url = parsedUrl(value);
  return url?.protocol === 'http:' || url?.protocol === 'https:';
}

export function networkAllowsUrl(value, policy, allowedOrigins = []) {
  const url = parsedUrl(value);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return true;
  if (allowedOrigins.includes(url.origin)) return true;
  if (policy.mode === 'trusted') return true;
  return policy.mode === 'allowlist' && policy.allowHosts.includes(normalizedHost(url.hostname));
}

export function assertNetworkAsset(reference, policy, label = 'Remote asset') {
  const scheme = String(reference).match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase();
  if (scheme && !['data', 'http', 'https'].includes(scheme)) {
    throw new Error(`${label} uses an unsafe URL protocol: ${reference}`);
  }
  if (!isRemoteUrl(reference) || networkAllowsUrl(reference, policy)) return;
  throw new Error(`${label} is blocked by security.network=${policy.mode}: ${reference}`);
}

export async function installRequestPolicy(page, policy, {
  allowedOrigins = [],
  offlineForDeny = false,
} = {}) {
  const observedExternal = [];
  const blocked = [];
  const errors = [];
  const pending = new Set();
  let activity = 0;
  const recordError = (error) => {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  };
  const track = (promise) => {
    pending.add(promise);
    promise.catch(() => {}).finally(() => pending.delete(promise));
  };
  const drain = async ({ settleMs = 0 } = {}) => {
    let observedActivity;
    do {
      observedActivity = activity;
      while (pending.size) await Promise.allSettled([...pending]);
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
    } while (pending.size || activity !== observedActivity);
  };
  const observeRequest = (request) => {
    const url = request.url();
    const remote = isRemoteUrl(url) && !allowedOrigins.includes(parsedUrl(url)?.origin);
    if (remote) observedExternal.push(url);
    return { remote, url };
  };

  const useOfflineMode = policy.mode === 'deny' && offlineForDeny;
  if (useOfflineMode) {
    await page.setOfflineMode(true);
  }

  // Interception is also required in trusted mode. Chromium can detach a
  // closing document before passive request observers receive its keepalive
  // fetches and beacons; interception keeps those requests observable until
  // they have been explicitly continued or aborted.
  await page.setRequestInterception(true);
  const settleRequest = async (request) => {
    let url = '<unavailable>';
    let shouldAbort = true;
    try {
      ({ url } = observeRequest(request));
      shouldAbort = !networkAllowsUrl(url, policy, allowedOrigins);
      if (shouldAbort) blocked.push(url);
    } catch (error) {
      recordError(error);
    }
    try {
      if (shouldAbort) await request.abort('blockedbyclient');
      else await request.continue();
    } catch (error) {
      recordError(error);
    }
  };
  const handleRequest = (request) => {
    activity += 1;
    track(settleRequest(request));
  };
  page.on('request', handleRequest);
  return {
    observedExternal,
    blocked,
    errors,
    drain,
    async disable() {
      page.off('request', handleRequest);
      await drain();
      if (typeof page.isClosed !== 'function' || !page.isClosed()) {
        await page.setRequestInterception(false);
        if (useOfflineMode) await page.setOfflineMode(false);
      }
    },
  };
}

export async function withRequestPolicy(page, policy, options, operation) {
  const {
    closePage = true,
    blockedRequestLabel = 'Network policy blocked request',
    ...requestOptions
  } = options ?? {};
  const requests = await installRequestPolicy(page, policy, requestOptions);
  let result;
  let primaryError;
  const cleanupErrors = [];

  const diagnostics = () => ({
    blockedRequests: [...new Set(requests.blocked)].sort(),
    policyErrors: requests.errors.map((error) => error.message),
  });
  const attachDiagnostics = (error) => {
    Object.assign(error, diagnostics());
    return error;
  };
  const recordCleanupError = (error) => {
    cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
  };

  try {
    result = await operation(requests);
  } catch (error) {
    primaryError = error;
  }

  if (closePage && (typeof page.isClosed !== 'function' || !page.isClosed())) {
    try {
      // Closing a scripted document can release pagehide keepalive fetches and
      // unload beacons after interception is removed. Navigate while the policy
      // is still installed, drain every settlement, then close the inert page.
      await page.goto('about:blank', { waitUntil: 'load' });
    } catch (error) {
      recordCleanupError(error);
    }
  }
  try {
    // Chromium dispatches unload beacons just after the replacement
    // navigation resolves. Require a quiet policy window before auditing.
    await requests.drain({ settleMs: 50 });
  } catch (error) {
    recordCleanupError(error);
  }

  if (!primaryError && requests.blocked.length) {
    primaryError = new Error(
      `${blockedRequestLabel}: ${[...new Set(requests.blocked)].sort().join(', ')}`,
    );
  }
  primaryError ??= requests.errors[0];
  if (primaryError) attachDiagnostics(primaryError);

  if (closePage && (typeof page.isClosed !== 'function' || !page.isClosed())) {
    try {
      await page.close();
    } catch (error) {
      recordCleanupError(error);
    }
  }
  try {
    await requests.disable();
  } catch (error) {
    recordCleanupError(error);
  }

  if (!primaryError && cleanupErrors.length) primaryError = cleanupErrors[0];
  if (primaryError && cleanupErrors.length) {
    if (primaryError.cause === undefined) primaryError.cause = cleanupErrors[0];
    primaryError.cleanupErrors = cleanupErrors.slice(0, 5).map(({ message }) => message);
  }
  if (primaryError) throw primaryError;
  return result;
}
