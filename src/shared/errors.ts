export function isInteractionNotAllowedError(cause: unknown): boolean {
  const raw = (() => {
    if (cause instanceof Error) {
      return `${cause.name} ${cause.message}`;
    }
    return JSON.stringify(cause ?? "") ?? "";
  })();
  return raw.includes("ERR_SECRETS_INTERACTION_NOT_ALLOWED");
}
