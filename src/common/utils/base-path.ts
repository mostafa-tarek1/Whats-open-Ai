export function normalizeBasePath(value?: string): string {
  const raw = value?.trim();

  if (!raw || raw === '/') {
    return '';
  }

  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

export function getConfiguredBasePath(): string {
  const explicitBasePath = normalizeBasePath(process.env.APP_BASE_PATH);

  if (explicitBasePath) {
    return explicitBasePath;
  }

  const baseUrl = process.env.BASE_URL;

  if (!baseUrl) {
    return '';
  }

  try {
    return normalizeBasePath(new URL(baseUrl).pathname);
  } catch {
    return '';
  }
}

export function getSocketIoPath(): string {
  return `${getConfiguredBasePath()}/socket.io`;
}
