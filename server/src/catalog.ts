export interface CatalogEntry { name: string; source: string; licence: string; note: string }

export const CATALOG: CatalogEntry[] = [
  {
    name: 'Chinook sample database',
    source: 'github.com/lerocha/chinook-database, version 1.4.5',
    licence: 'MIT, Copyright (c) 2008-2024 Luis Rocha',
    note: 'Sample data. Customers and sales are not real.',
  },
];
