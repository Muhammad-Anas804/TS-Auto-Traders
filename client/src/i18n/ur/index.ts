import shell from './shell';
import docs from './docs';
import parties from './parties';
import reports from './reports';
import settings from './settings';

/** All Urdu translations, merged. Each group lives in its own file so they can be edited independently. */
const ur: Record<string, string> = { ...shell, ...docs, ...parties, ...reports, ...settings };
export default ur;
