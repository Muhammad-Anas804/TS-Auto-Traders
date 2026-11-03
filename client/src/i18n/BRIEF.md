# Brief for agents translating the app into Urdu (read fully before editing)

Project: /home/claude/ts-auto-trader/client (React 19 + TypeScript + Vite, source in src/). A billing app for an auto-parts shop in Pakistan.
Several agents work at the same time on DIFFERENT files. Edit ONLY your own files and your own dictionary file.

Read first: src/i18n/index.ts (t / tk / tInvoice API), src/i18n/GLOSSARY.md (exact Urdu words), src/i18n/allowed.ts, src/i18n/i18n.test.ts (the check you must pass).

## Rules
- `import { t, tk } from '../i18n'` (fix the relative path). English text IS the key: `t('Save')`; parameters: `t('{n} items', { n })`.
- Every user-visible English text goes through t(): JSX text, placeholder, title, aria-label, button labels, table headers, <option> labels, empty states, hints, toasts, confirm questions, validation/error messages shown to the user. Replace template-string sentences with ONE key with {placeholders}: t('Sold {qty} of {name}', { qty, name }). Never concatenate translated fragments (Urdu word order differs).
- Tables/constants holding English labels: mark with tk('...') where defined, call t(value) where shown: `const LABEL = { sale: tk('Sale') }` ... `{t(LABEL[kind])}`. Keys passed to t()/tk() must be plain string literals (no variables, no `${}`). A line that truly needs an exception (dynamic t(x) over tk() values, console-only errors) gets the comment `// i18n-ok`.
- Keep English as-is: brand names, units in data, file types, 'Rs', user data (item/customer names, notes). Numbers stay Western digits (0-9); dates stay dd-mm-yyyy. See src/i18n/allowed.ts (add to ALLOWED_TEXT only if needed).
- Translations go ONLY in your dictionary file src/i18n/ur/<group>.ts inside the existing `const dict` object as `'English key': 'اردو',`. Every key used needs an entry, {placeholders} identical. Use glossary words exactly. Write natural, short, friendly everyday shop Urdu, not bookish. Proper punctuation (، ؟ ۔). If another group also uses the same English text, translate it identically (a test fails on clashes).
- Layout must work right-to-left: when you add CSS use logical properties (margin-inline-start, text-align: start/end), never left/right. You may append CSS only at the very END of src/styles.css in a clearly marked block.
- Do not change behaviour or logic. Only wrap texts, small attribute additions, keep it compiling.

## When done
1. `cd /home/claude/ts-auto-trader/client && I18N_FILES=<your files, comma separated, e.g. pages/Foo.tsx,components/Bar.tsx> npx vitest run src/i18n` must pass for your files (ignore the dictionary-clash test if it fails only because of another group, and the "unused entries" test is skipped when I18N_FILES is set).
2. `npx tsc --noEmit`: fix errors in YOUR files (ignore other files; others are mid-edit).
3. `npx vitest run src/lib` still passes.
4. Reply SHORT: number of keys added; Urdu wording a native speaker should review; anything not translated and why.
