const NETWORK_MODES = new Set(['trusted', 'allowlist', 'deny']);

function normalizedHost(value) {
  return String(value).trim().toLowerCase().replace(/^\[|\]$/gu, '');
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
    allowHosts: [...new Set(policy.allowHosts.map(normalizedHost).filter(Boolean))],
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
  const observeRequest = (request) => {
    const url = request.url();
    const remote = isRemoteUrl(url) && !allowedOrigins.includes(parsedUrl(url)?.origin);
    if (remote) observedExternal.push(url);
    return { remote, url };
  };

  if (policy.mode === 'trusted') {
    const handleTrustedRequest = (request) => observeRequest(request);
    page.on('request', handleTrustedRequest);
    return {
      observedExternal,
      blocked,
      async disable() {
        page.off('request', handleTrustedRequest);
      },
    };
  }

  if (policy.mode === 'deny' && offlineForDeny) {
    const handleOfflineRequest = (request) => {
      const { remote, url } = observeRequest(request);
      if (remote) blocked.push(url);
    };
    page.on('request', handleOfflineRequest);
    await page.setOfflineMode(true);
    return {
      observedExternal,
      blocked,
      async disable() {
        page.off('request', handleOfflineRequest);
        await page.setOfflineMode(false);
      },
    };
  }

  await page.setRequestInterception(true);
  const handleRequest = (request) => {
    const { url } = observeRequest(request);
    if (!networkAllowsUrl(url, policy, allowedOrigins)) {
      blocked.push(url);
      request.abort('blockedbyclient');
      return;
    }
    request.continue();
  };
  page.on('request', handleRequest);
  return {
    observedExternal,
    blocked,
    async disable() {
      page.off('request', handleRequest);
      await page.setRequestInterception(false);
    },
  };
}
