// components/withDbMultiLang.tsx
//
// Same shape as the plug.zip reference's withMultiLang.tsx, but:
//   - the "module" + "propMap" come from a JSON file (component.json-style),
//     e.g. form.multilang.json / domain-list.multilang.json
//   - translations are resolved using your EXISTING two tables, no new table:
//
//       domain_attributes:      id, dmo_name, dmo_attribute_name, label, field_type
//       attribute_translations: id, attribute_id (-> domain_attributes.id), lang_code, label
//
//     "module" (e.g. "form", "domain-list") is just used as dmo_name — a
//     pseudo-domain for plugin-chrome strings, exactly like a real domain
//     uses its table name. dmo_attribute_name is the propMap key
//     (e.g. "submitLabel"), same FK relationship as any real field.

import { useFieldTranslations, useAppLanguage, LanguageProvider } from '../hooks/useFieldTranslations';

export { useFieldTranslations, useAppLanguage, LanguageProvider };

interface MultiLangConfig {
  module: string;
  propMap: Record<string, string>; // *Key prop -> real prop name
}

export function withDbMultiLang<P extends object>(
  Component: React.ComponentType<P>,
  config: MultiLangConfig,
) {
  const { module, propMap } = config;

  return function MLComponent(props: P & Record<string, any>) {
    const { translateLabel } = useFieldTranslations(module);

    // ── Resolve *Key props -> real prop names ────────────────────────────
    // translateLabel(attributeName, fallback) looks up dmo_name=module,
    // dmo_attribute_name=targetProp in domain_attributes, then the matching
    // attribute_translations row for the current language.
    const resolved: Record<string, any> = {};
    Object.entries(propMap).forEach(([keyProp, targetProp]) => {
      const fallback = props[keyProp] ?? props[targetProp];
      if (fallback != null) {
        resolved[targetProp] = translateLabel(targetProp, fallback);
      }
    });

    // ── Strip *Key props before passing down ───────────────────────────
    const cleanProps = { ...props };
    Object.keys(propMap).forEach(k => delete cleanProps[k]);

    return <Component {...(cleanProps as P)} {...resolved} />;
  };
}