import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Lang = 'en' | 'de' | 'fr';

export const LANG_STORAGE_KEY = 'echo_lang';

export function getStoredLang(): Lang {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get('lang') || '').toLowerCase();
    if (q === 'de' || q === 'en' || q === 'fr') {
      return q;
    }
    const stored = (localStorage.getItem(LANG_STORAGE_KEY) || '').toLowerCase();
    if (stored === 'de' || stored === 'en' || stored === 'fr') {
      return stored;
    }
  } catch (_e) {
    // Ignore storage / URL errors in constrained environments
  }
  return 'en';
}

export function trStatic(en: string, de: string, fr?: string, lang?: Lang): string {
  const active = lang || getStoredLang();
  if (active === 'de') return de;
  if (active === 'fr') return fr ?? en;
  return en;
}

const REL_LABELS_EN: Record<string, string> = {
  RAUBTE: 'LOOTED',
  ENTEIGNETE: 'CONFISCATED',
  EIGNETE_SICH_AN: 'APPROPRIATED',
  SCHENKTE: 'DONATED (CLAIMED)',
  VERKAUFTE_AN: 'SOLD TO',
  UEBERGAB_AN: 'TRANSFERRED TO',
  LAGERT_IN: 'HELD AT',
  VERDACHT_AUF: 'SUSPECTED',
  WAR_BETEILIGT_AN: 'PARTICIPATED IN',
  VISUELL_IDENTIFIZIERT_MIT: 'VISUALLY MATCHED',
  BELEGT_IN: 'CITED IN',
  STAMMT_AUS: 'ORIGINATES FROM',
  BESCHRIEB: 'DESCRIBED',
};

const REL_LABELS_FR: Record<string, string> = {
  RAUBTE: 'PILLÉ',
  ENTEIGNETE: 'CONFISQUÉ',
  EIGNETE_SICH_AN: 'APPROPRIÉ',
  SCHENKTE: 'DON (ALLÉGUÉ)',
  VERKAUFTE_AN: 'VENDU À',
  UEBERGAB_AN: 'TRANSFÉRÉ À',
  LAGERT_IN: 'CONSERVÉ À',
  VERDACHT_AUF: 'SOUPÇONNÉ',
  WAR_BETEILIGT_AN: 'A PARTICIPÉ À',
  VISUELL_IDENTIFIZIERT_MIT: 'IDENTIFIÉ VISUELLEMENT',
  BELEGT_IN: 'CITÉ DANS',
  STAMMT_AUS: 'PROVIENT DE',
  BESCHRIEB: 'DÉCRIT',
};

export function relLabel(relType: string | undefined | null, lang: Lang): string {
  const raw = String(relType || '').trim();
  if (!raw) return '';
  if (lang === 'de') return raw;
  if (lang === 'fr') return REL_LABELS_FR[raw] || REL_LABELS_EN[raw] || raw;
  return REL_LABELS_EN[raw] || raw;
}

const NODE_TYPE_LABELS_EN: Record<string, string> = {
  Subjekt: 'OBJECT',
  Objekt: 'OBJECT',
  Akteur: 'ACTOR',
  Institution: 'DEPOT / MUSEUM',
  Polity: 'ORIGIN POLITY',
  Publikation: 'PUBLICATION',
};

const NODE_TYPE_LABELS_FR: Record<string, string> = {
  Subjekt: 'OBJET',
  Objekt: 'OBJET',
  Akteur: 'ACTEUR',
  Institution: 'DÉPÔT / MUSÉE',
  Polity: "POLITY D'ORIGINE",
  Publikation: 'PUBLICATION',
};

export function nodeTypeLabel(type: string | undefined | null, lang: Lang): string {
  const raw = String(type || '').trim();
  if (!raw) return '';
  if (lang === 'de') return raw.toUpperCase();
  if (lang === 'fr') return NODE_TYPE_LABELS_FR[raw] || raw.toUpperCase();
  return NODE_TYPE_LABELS_EN[raw] || raw.toUpperCase();
}

const METRIC_FILTER_LABELS_EN: Record<string, string> = {
  subjekte: 'OBJECTS',
  raub: 'LOOTING',
  schenkung: 'DONATIONS',
  dissonanz: 'DISSONANCE',
  verdacht: 'SUSPICION',
  akteure: 'ACTORS',
  depots: 'DEPOTS',
  luecken: 'PROVENANCE GAPS',
};

const METRIC_FILTER_LABELS_FR: Record<string, string> = {
  subjekte: 'OBJETS',
  raub: 'PILLAGES',
  schenkung: 'DONS',
  dissonanz: 'DISSONANCE',
  verdacht: 'SOUPÇONS',
  akteure: 'ACTEURS',
  depots: 'DÉPÔTS',
  luecken: 'LACUNES',
};

export function metricFilterLabel(filter: string | null, lang: Lang): string {
  if (!filter) return '';
  if (lang === 'de') return filter.toUpperCase();
  if (lang === 'fr') return METRIC_FILTER_LABELS_FR[filter] || filter.toUpperCase();
  return METRIC_FILTER_LABELS_EN[filter] || filter.toUpperCase();
}

const VERDICT_LABELS_EN: Record<string, string> = {
  STARKE_INDIVIDUELLE_OBJEKTIDENTITAET: 'STRONG INDIVIDUAL OBJECT IDENTITY',
  WAHRSCHEINLICHE_KORRESPONDENZ_PRUEFBEDUERFTIG: 'PROBABLE CORRESPONDENCE (REVIEW REQUIRED)',
  ABGELEHNT_KEINE_INDIVIDUELLE_UEBEREINSTIMMUNG: 'REJECTED — NO INDIVIDUAL MATCH',
  KEINE_GEOMETRISCHE_KONSISTENZ: 'NO GEOMETRIC CONSISTENCY',
  INSUFFICIENT_FEATURES: 'INSUFFICIENT STRUCTURAL FEATURES',
};

const VERDICT_LABELS_DE: Record<string, string> = {
  STARKE_INDIVIDUELLE_OBJEKTIDENTITAET: 'STARKE INDIVIDUELLE OBJEKTIDENTITAET',
  WAHRSCHEINLICHE_KORRESPONDENZ_PRUEFBEDUERFTIG: 'WAHRSCHEINLICHE KORRESPONDENZ (PRUEFBEDUERFTIG)',
  ABGELEHNT_KEINE_INDIVIDUELLE_UEBEREINSTIMMUNG: 'ABGELEHNT — KEINE INDIVIDUELLE UEBEREINSTIMMUNG',
  KEINE_GEOMETRISCHE_KONSISTENZ: 'KEINE GEOMETRISCHE KONSISTENZ',
  INSUFFICIENT_FEATURES: 'ZU WENIGE STRUKTURMERKMALE',
};

const VERDICT_LABELS_FR: Record<string, string> = {
  STARKE_INDIVIDUELLE_OBJEKTIDENTITAET: "FORTE IDENTITÉ D'OBJET INDIVIDUEL",
  WAHRSCHEINLICHE_KORRESPONDENZ_PRUEFBEDUERFTIG: 'CORRESPONDANCE PROBABLE (RÉVISION REQUISE)',
  ABGELEHNT_KEINE_INDIVIDUELLE_UEBEREINSTIMMUNG: 'REJETÉ — AUCUNE CORRESPONDANCE INDIVIDUELLE',
  KEINE_GEOMETRISCHE_KONSISTENZ: 'AUCUNE COHÉRENCE GÉOMÉTRIQUE',
  INSUFFICIENT_FEATURES: 'CARACTÉRISTIQUES STRUCTURELLES INSUFFISANTES',
};

export function translateVerdict(verdict: string | undefined | null, lang: Lang): string {
  const raw = String(verdict || '').trim();
  if (!raw) return '';
  if (lang === 'de') return VERDICT_LABELS_DE[raw] || raw;
  if (lang === 'fr') return VERDICT_LABELS_FR[raw] || raw;
  return VERDICT_LABELS_EN[raw] || raw;
}

const DEMO_FRAME_TEXT: Record<Lang, Record<string, { label: string; location: string; source: string }>> = {
  en: {
    plate_1902_kimbo: {
      label: 'Glass-Plate Field Photograph (Kumbo, 1902)',
      location: 'Kimbo / Kumbo (Nso, Cameroon)',
      source: 'Schutztruppe Estate / Pavel Expedition (Archival Print)',
    },
    plate_1908_umlauff: {
      label: 'Sales Catalog J.F.G. Umlauff (Hamburg, 1908)',
      location: 'Hamburg (Umlauff Trading House)',
      source: 'Catalog Plate No. 14, Lot 418 (No Original Inv. No.)',
    },
    plate_2024_depot: {
      label: 'Contemporary Depot Digitization (Berlin, 2024)',
      location: 'Berlin (Museum Depot)',
      source: "Collection Digitization 'Unknown Legacy Holding'",
    },
    control_other_carving: {
      label: 'Negative Control: Related Style, Different Object',
      location: 'Stuttgart (Comparison Specimen)',
      source: 'Control Sample Against Cultural Style Conflation',
    },
  },
  de: {
    plate_1902_kimbo: {
      label: 'Feldaufnahme Glasplatte (Kimbo, 1902)',
      location: 'Kimbo / Kumbo (Nso, Kamerun)',
      source: 'Nachlass Schutztruppe / Expedition Pavel (Archivabzug)',
    },
    plate_1908_umlauff: {
      label: 'Verkaufskatalog J.F.G. Umlauff (Hamburg, 1908)',
      location: 'Hamburg (Handelshaus Umlauff)',
      source: 'Katalogtafel Nr. 14, Pos. 418 (ohne Ursprungs-Inv.)',
    },
    plate_2024_depot: {
      label: 'Heutige Depot-Digitalisierung (Berlin, 2024)',
      location: 'Berlin (Museumsdepot)',
      source: "Bestandsdigitalisierung 'Unbekannter Altbestand'",
    },
    control_other_carving: {
      label: 'Negativprobe: Verwandter Stil, anderes Objekt',
      location: 'Stuttgart (Vergleichsstueck)',
      source: 'Kontrollprobe gegen kulturelle Pauschal-Verwechslung',
    },
  },
  fr: {
    plate_1902_kimbo: {
      label: 'Photographie de terrain sur plaque de verre (Kumbo, 1902)',
      location: 'Kimbo / Kumbo (Nso, Cameroun)',
      source: 'Fonds Schutztruppe / Expédition Pavel (Tirage d’archive)',
    },
    plate_1908_umlauff: {
      label: 'Catalogue de vente J.F.G. Umlauff (Hambourg, 1908)',
      location: 'Hambourg (Maison de commerce Umlauff)',
      source: 'Planche n° 14, lot 418 (sans n° d’inv. d’origine)',
    },
    plate_2024_depot: {
      label: 'Numérisation actuelle en dépôt (Berlin, 2024)',
      location: 'Berlin (Dépôt muséal)',
      source: "Numérisation des collections « Fonds ancien inconnu »",
    },
    control_other_carving: {
      label: 'Témoin négatif : style apparenté, autre objet',
      location: 'Stuttgart (Pièce de comparaison)',
      source: 'Échantillon témoin contre la confusion stylistique',
    },
  },
};

export function localizeDemoFrame<T extends { id: string; label: string; location: string; source: string }>(
  frame: T,
  lang: Lang,
): T {
  const target = DEMO_FRAME_TEXT[lang]?.[frame.id];
  if (!target) return frame;

  const knownLabels = new Set((['en', 'de', 'fr'] as Lang[]).map((l) => DEMO_FRAME_TEXT[l]?.[frame.id]?.label));
  const knownLocations = new Set((['en', 'de', 'fr'] as Lang[]).map((l) => DEMO_FRAME_TEXT[l]?.[frame.id]?.location));
  const knownSources = new Set((['en', 'de', 'fr'] as Lang[]).map((l) => DEMO_FRAME_TEXT[l]?.[frame.id]?.source));

  return {
    ...frame,
    label: knownLabels.has(frame.label) ? target.label : frame.label,
    location: knownLocations.has(frame.location) ? target.location : frame.location,
    source: knownSources.has(frame.source) ? target.source : frame.source,
  };
}

const DEFAULT_POI_DESC: Record<Lang, Record<string, string>> = {
  en: {
    'Ngonnso (Ahnenfigur der Nso)': 'Sacred female ancestral figure of the Nso',
    'Mandu Yenu (Königsthron)': 'Beaded royal throne of the Kingdom of Bamum',
    'III C 15017': 'Slit drum from Banssa / Bafut (1902)',
  },
  de: {
    'Ngonnso (Ahnenfigur der Nso)': 'Sakrale weibliche Ahnenfigur der Nso',
    'Mandu Yenu (Königsthron)': 'Perlenbesetzter Königsthron von Bamum',
    'III C 15017': 'Schlitztrommel aus Banssa / Bafut (1902)',
  },
  fr: {
    'Ngonnso (Ahnenfigur der Nso)': 'Figure ancestrale féminine sacrée des Nso',
    'Mandu Yenu (Königsthron)': 'Trône royal perlé du royaume Bamoun',
    'III C 15017': 'Tambour à fente de Banssa / Bafut (1902)',
  },
};

export function localizePoiDesc(poi: { id: string; desc: string }, lang: Lang): string {
  const target = DEFAULT_POI_DESC[lang]?.[poi.id];
  if (!target) return poi.desc;
  const known = new Set((['en', 'de', 'fr'] as Lang[]).map((l) => DEFAULT_POI_DESC[l]?.[poi.id]));
  return known.has(poi.desc) ? target : poi.desc;
}

function syncDocumentLegalWidget(lang: Lang) {
  try {
    document.documentElement.lang = lang;
    const btn = document.getElementById('echo-legal-btn');
    if (btn) {
      btn.textContent =
        lang === 'de'
          ? 'Impressum & Datenschutz (§ 5 DDG)'
          : lang === 'fr'
            ? 'Mentions légales & Confidentialité (§ 5 DDG)'
            : 'Legal Notice & Privacy (§ 5 DDG)';
    }
    const title = document.getElementById('echo-legal-title');
    if (title) {
      title.textContent =
        lang === 'de'
          ? 'Impressum & Datenschutz (§ 5 DDG / DSGVO)'
          : lang === 'fr'
            ? 'Mentions légales & Confidentialité (§ 5 DDG / RGPD)'
            : 'Legal Notice & Privacy (§ 5 DDG / GDPR)';
    }
    const bodyEn = document.getElementById('echo-legal-body-en');
    const bodyDe = document.getElementById('echo-legal-body-de');
    const bodyFr = document.getElementById('echo-legal-body-fr');
    if (bodyEn) bodyEn.style.display = lang === 'en' ? 'block' : 'none';
    if (bodyDe) bodyDe.style.display = lang === 'de' ? 'block' : 'none';
    if (bodyFr) bodyFr.style.display = lang === 'fr' ? 'block' : 'none';
  } catch (_e) {
    // Ignore DOM errors
  }
}

interface LangContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  cycleLang: () => void;
  t: (en: string, de: string, fr?: string) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => {},
  cycleLang: () => {},
  t: (en) => en,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch (_e) {}
    syncDocumentLegalWidget(next);
  }, []);

  const cycleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === 'en' ? 'de' : prev === 'de' ? 'fr' : 'en';
      try {
        localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch (_e) {}
      syncDocumentLegalWidget(next);
      return next;
    });
  }, []);

  useEffect(() => {
    syncDocumentLegalWidget(lang);
  }, [lang]);

  const t = useCallback(
    (en: string, de: string, fr?: string) => (lang === 'de' ? de : lang === 'fr' ? (fr ?? en) : en),
    [lang],
  );

  return (
    <LangContext.Provider value={{ lang, setLang, cycleLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
