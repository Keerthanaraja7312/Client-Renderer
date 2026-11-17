// hooks/useFieldTranslations.ts
import { useEffect, useMemo, useState, createContext, useContext } from 'react';

// ── App-wide current-language context ───────────────────────────────────────

interface LangCtx {
  lang: string;
  setLang: (l: string) => void;
}
const LanguageContext = createContext<LangCtx>({ lang: 'en', setLang: () => {} });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<string>(
    () => sessionStorage.getItem('app_lang') || 'en'
  );
  useEffect(() => { sessionStorage.setItem('app_lang', lang); }, [lang]);
  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useAppLanguage() {
  return useContext(LanguageContext);
}

// ── Per-domain translation cache ─────────────────────────────────────────────

const translationsByDomain = new Map<string, Record<string, Record<string, string>>>();

export function invalidateFieldTranslationCache(domainName?: string) {
  if (domainName) {
    translationsByDomain.delete(domainName);
  } else {
    translationsByDomain.clear();
  }
}

// ── Per-domain hook ──────────────────────────────────────────────────────────

export function useFieldTranslations(domainName: string | null | undefined) {
  const { lang, setLang } = useAppLanguage();
  const [translations, setTranslations] = useState<Record<string, Record<string, string>>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!domainName) {
      setReady(true);
      return;
    }

    if (translationsByDomain.has(domainName)) {
      setTranslations(translationsByDomain.get(domainName)!);
      setReady(true);
      return;
    }

    fetch(`/datastore/domain-attributes/${domainName}/translations`)
      .then(r => r.json())
      .then(res => {
        const data = res.data ?? {};
        translationsByDomain.set(domainName, data);
        setTranslations(data);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [domainName]);

  // All languages available for this domain
  const languages = useMemo(() => {
    const langs = new Set<string>(['en']);
    Object.values(translations).forEach(t =>
      Object.keys(t).forEach(l => langs.add(l))
    );
    return Array.from(langs).sort();
  }, [translations]);

  /** Resolve a field's label for the current language, falling back to English / fallback / fieldId */
  function translateLabel(fieldId: string, fallback?: string): string {
    console.log('current lang:', lang, 'fieldId:', fieldId, 'translations:', translations[fieldId]);
    const field = translations[fieldId];
    if (!field) return fallback ?? fieldId;
    return field[lang] ?? field['en'] ?? fallback ?? fieldId;
  }

  return { translateLabel, lang, setLang, languages, loading: !ready };
}