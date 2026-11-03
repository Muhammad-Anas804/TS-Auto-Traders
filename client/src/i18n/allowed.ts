/**
 * Text that is allowed to stay English on an Urdu screen: brand names, units, file types, key names.
 * Anything else that is shown to people must go through t().
 */
export const ALLOWED_TEXT = new Set<string>([
  'TS Auto Trader', 'SAZ', 'Rs', 'CSV', 'PDF', 'JSON', 'A4', 'WhatsApp', 'WhatsApp PDF', 'Chrome', 'Edge', 'Alt+C', 'Alt+F', 'Esc', 'Enter',
  'English', 'اردو', 'Both / دونوں', 'https://your-server.example.com', 'https://abcd1234.supabase.co', '{title} {no}', 'SAZ, Master Parts…', 'Pcs, Set, Box', 'PO', 'NTN', 'STRN', 'URL', 'SKU', 'OK', 'HTTPS', 'Pcs', 'Rs.',
]);

/** Files that contain data rather than screen text (sample items, CSV column names, server messages, tests). */
export const SKIP_FILES = ['lib/seed.ts', 'lib/csv.ts', 'test-setup.ts', 'components/LangSwitch.tsx'];
