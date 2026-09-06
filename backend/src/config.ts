import 'dotenv/config';

export interface Settings {
  databaseUrl: string;
  organizerToken: string;
  appName: string;
}
export function settings(env = process.env): Settings {
  const databaseUrl = env.ISARD_DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('mysql://'))
    throw new Error('Configura ISARD_DATABASE_URL con una conexión mysql://.');
  return {
    databaseUrl,
    organizerToken: env.ISARD_ORGANIZER_TOKEN ?? '',
    appName: env.ISARD_APP_NAME ?? 'ISARD Code Battle',
  };
}
