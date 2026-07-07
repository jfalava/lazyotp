type SecretsApi = {
  set(input: { service: string; name: string; value: string }): Promise<void>;
  get(input: { service: string; name: string }): Promise<string | null>;
  delete(input: { service: string; name: string }): Promise<boolean>;
};

// Bun.secrets has no native "list" capability, since it is a thin wrapper
// around OS-native credential stores (Keychain/libsecret/Credential
// Manager). To support `lazyotp list`, we maintain our own index of aliases
// per service, stored as a JSON array under this reserved alias name.
const ALIAS_INDEX_NAME = "__lazyotp_alias_index__";

function readSecretsApi(): SecretsApi {
  const maybeBun = Reflect.get(globalThis, "Bun") as
    | { secrets?: SecretsApi }
    | undefined;
  const secrets = maybeBun?.secrets;
  if (!secrets) {
    throw new Error("Bun runtime with Bun.secrets is required.");
  }
  return secrets;
}

function assertNotReservedAlias(alias: string): void {
  if (alias === ALIAS_INDEX_NAME) {
    throw new Error(`Alias "${alias}" is reserved and cannot be used.`);
  }
}

async function readAliasIndex(
  secrets: SecretsApi,
  service: string,
): Promise<string[]> {
  const raw = await secrets.get({ service, name: ALIAS_INDEX_NAME });
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeAliasIndex(
  secrets: SecretsApi,
  service: string,
  aliases: string[],
): Promise<void> {
  await secrets.set({
    service,
    name: ALIAS_INDEX_NAME,
    value: JSON.stringify(aliases),
  });
}

async function addAliasToIndex(
  secrets: SecretsApi,
  service: string,
  alias: string,
): Promise<void> {
  const aliases = await readAliasIndex(secrets, service);
  if (!aliases.includes(alias)) {
    aliases.push(alias);
    await writeAliasIndex(secrets, service, aliases);
  }
}

async function removeAliasFromIndex(
  secrets: SecretsApi,
  service: string,
  alias: string,
): Promise<void> {
  const aliases = await readAliasIndex(secrets, service);
  const filtered = aliases.filter((existing) => existing !== alias);
  if (filtered.length !== aliases.length) {
    await writeAliasIndex(secrets, service, filtered);
  }
}

export async function setStoredSecret(
  service: string,
  alias: string,
  secret: string,
): Promise<void> {
  assertNotReservedAlias(alias);
  const secrets = readSecretsApi();
  await secrets.set({
    service,
    name: alias,
    value: secret,
  });
  await addAliasToIndex(secrets, service, alias);
}

export async function getStoredSecret(
  service: string,
  alias: string,
): Promise<string | null> {
  const secrets = readSecretsApi();
  return secrets.get({
    service,
    name: alias,
  });
}

export async function deleteStoredSecret(
  service: string,
  alias: string,
): Promise<boolean> {
  const secrets = readSecretsApi();
  const deleted = await secrets.delete({
    service,
    name: alias,
  });
  await removeAliasFromIndex(secrets, service, alias);
  return deleted;
}

export async function listStoredAliases(service: string): Promise<string[]> {
  const secrets = readSecretsApi();
  const aliases = await readAliasIndex(secrets, service);
  return [...aliases].sort((a, b) => a.localeCompare(b));
}
