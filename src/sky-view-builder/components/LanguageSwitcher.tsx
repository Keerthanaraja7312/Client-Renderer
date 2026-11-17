// components/LanguageSwitcher.tsx
import { Languages } from 'lucide-react';

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ta: 'தமிழ்',
  hi: 'हिन्दी',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  zh: '中文',
  ja: '日本語',
  ar: 'العربية',
};

export function LanguageSwitcher({
  lang,
  setLang,
  languages,
}: {
  lang: string;
  setLang: (l: string) => void;
  languages: string[];
}) {
  if (languages.length <= 1) return null;

  return (
    <div className="relative z-50 flex items-center gap-1.5 bg-secondary/60 border border-border rounded-xl px-2 py-1">
      <Languages className="w-3 h-3 text-muted-foreground/50" />
      <select
        value={lang}
        onChange={e => {
          console.log('switching to:', e.target.value);
          setLang(e.target.value);
        }}
        className="relative z-50 bg-transparent text-[11px] font-bold text-foreground outline-none cursor-pointer pointer-events-auto"
      >
        {languages.map(l => (
          <option key={l} value={l}>{LANG_NAMES[l] ?? l.toUpperCase()}</option>
        ))}
      </select>
    </div>
  );
}