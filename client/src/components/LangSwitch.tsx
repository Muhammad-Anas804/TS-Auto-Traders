import { toggleLang, useLang } from '../i18n';

/** One-tap language button. Always shows the name of the OTHER language, written in that language. */
export default function LangSwitch({ className = 'btn sm' }: { className?: string }) {
  const lang = useLang();
  return (
    <button
      type="button" className={className} onClick={toggleLang}
      lang={lang === 'en' ? 'ur' : 'en'}
      aria-label={lang === 'en' ? 'اردو میں تبدیل کریں' : 'Switch to English'}
      title={lang === 'en' ? 'اردو' : 'English'}
    >
      🌐 {lang === 'en' ? 'اردو' : 'English'}
    </button>
  );
}
