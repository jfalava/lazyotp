export function isInteractionNotAllowedError(error: unknown): boolean {
  const raw = (() => {
    if (error instanceof Error) {
      return `${error.name} ${error.message}`;
    }
    if (typeof error === "string") {
      return error;
    }
    return JSON.stringify(error ?? "");
  })();
  return raw.includes("ERR_SECRETS_INTERACTION_NOT_ALLOWED");
}
