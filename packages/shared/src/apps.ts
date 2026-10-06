// The apps of the household, for the links between them in each profile.

export type AppId = 'shopping' | 'cash';

export interface AppInfo {
  id: AppId;
  // Name shown in the interface.
  name: string;
  host: string;
  devPort: number;
  // Inner markup of the 24×24 stroke icon of the app.
  icon: string;
}

export const APPS: readonly AppInfo[] = [
  {
    id: 'shopping',
    name: 'Spesa',
    host: 'shopping.skybreaker.dev',
    devPort: 4321,
    icon: '<path d="M4.5 10h15l-1.5 8.2a2 2 0 0 1-2 1.8H8a2 2 0 0 1-2-1.8z"/><path d="M8.5 10 12 4.5 15.5 10"/><path d="M10 13.5v3M14 13.5v3"/>',
  },
  {
    id: 'cash',
    name: 'Conti',
    host: 'cash.skybreaker.dev',
    devPort: 4322,
    icon: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5"/><path d="M5.5 11.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5"/>',
  },
];

export interface AppLink {
  id: AppId;
  name: string;
  url: string;
  icon: string;
}

// The other apps: production URLs on skybreaker.dev, the development ports anywhere else.
export function otherApps(current: AppId, here: Pick<Location, 'protocol' | 'hostname'> = location): AppLink[] {
  const production = here.hostname.endsWith('.skybreaker.dev');
  return APPS.filter((app) => app.id !== current).map((app) => ({
    id: app.id,
    name: app.name,
    url: production ? `https://${app.host}/` : `${here.protocol}//${here.hostname}:${app.devPort}/`,
    icon: app.icon,
  }));
}

// Alpine data of the AppLinks component.
export const appLinks = (current: AppId) => ({ links: otherApps(current) });
