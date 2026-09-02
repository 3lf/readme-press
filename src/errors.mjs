/** A stable, machine-readable README Press failure. */
export class ReadmePressError extends Error {
  constructor(message, {
    code = 'ERR_README_PRESS',
    details = null,
    cause,
    exitCode = 1,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ReadmePressError';
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function toReadmePressError(error, fallback = {}) {
  if (error instanceof ReadmePressError) return error;
  return new ReadmePressError(error?.message ?? String(error), {
    code: fallback.code ?? 'ERR_README_PRESS',
    details: fallback.details ?? null,
    cause: error,
    exitCode: fallback.exitCode ?? 1,
  });
}
