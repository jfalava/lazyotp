type SecretsApi = {
  set(input: { service: string; name: string; value: string }): Promise<void>;
  get(input: { service: string; name: string }): Promise<string | null>;
  delete(input: { service: string; name: string }): Promise<boolean>;
};

function readSecretsApi(): SecretsApi {
  const maybeBun = Reflect.get(globalThis, "Bun") as { secrets?: SecretsApi } | undefined;
  const secrets = maybeBun?.secrets;
  if (!secrets) {
    throw new Error("Bun runtime with Bun.secrets is required.");
  }
  return secrets;
}

export async function setStoredSecret(service: string, alias: string, secret: string): Promise<void> {
  const secrets = readSecretsApi();
  await secrets.set({
    service,
    name: alias,
    value: secret,
  });
}

export async function getStoredSecret(service: string, alias: string): Promise<string | null> {
  const secrets = readSecretsApi();
  return secrets.get({
    service,
    name: alias,
  });
}

export async function deleteStoredSecret(service: string, alias: string): Promise<boolean> {
  const secrets = readSecretsApi();
  return secrets.delete({
    service,
    name: alias,
  });
}
