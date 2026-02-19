import fr from './dictionaries/fr.json';
const dictionaries: Record<string, Record<string, any>> = { fr };
let currentLocale = 'fr';

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] || dictionaries.fr;
  let value = getNestedValue(dict, key);
  if (!value) return key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => { value = value!.replace(`{${k}}`, String(v)); });
  }
  return value;
}
export function useT() { return { t, locale: currentLocale }; }
