/**
 * Client-side Multilingual Provenance Triple Extractor (EN / DE / FR).
 * Mirrors extract_provenance_triples.py so researchers can paste archival paragraphs or drop .txt/.csv files
 * directly in the serverless browser app and preview/verify extracted triples before committing.
 */

export type HighlightKind = 'object' | 'actor' | 'depot' | 'loot' | 'donation' | 'community';

export interface TextHighlightSpan {
  text: string;
  kind: HighlightKind | null;
}

export interface ExtractedTriple {
  source: string;
  source_label: string;
  source_type: 'Akteur' | 'Subjekt' | 'Institution';
  source_desc: string;
  target: string;
  target_label: string;
  target_type: 'Akteur' | 'Subjekt' | 'Institution';
  target_desc: string;
  type: string;
  beleg: string;
  jahr: number | null;
  kollision: boolean;
  narrativ: string;
  herkunft?: string;
  paragraph_index?: number;
  source_excerpt?: string;
  zitat?: string;
}

const KNOWN_ACTORS: Record<string, { rolle: string; pattern: RegExp }> = {
  'Hans Glauning': { rolle: 'Colonial Officer / Bamenda Station', pattern: /\bGlauning\b/ },
  'Jesko von Puttkamer': { rolle: 'Governor of Cameroon', pattern: /\bPuttkamer\b/ },
  'Curt von Pavel': { rolle: 'Schutztruppe Commander', pattern: /\bPavel\b/ },
  'Max von Stetten': { rolle: 'Officer / Station Chief', pattern: /\bStetten\b/ },
  'Eugen Zintgraff': { rolle: 'Colonial Explorer', pattern: /\bZintgraff\b/ },
  'Adolf Diehl': { rolle: 'Merchant / Collector', pattern: /\bDiehl\b/ },
  'König Njoya': { rolle: 'Fon / Sultan of Bamum', pattern: /\bNjoya\b/ },
  'Curt von Morgen': { rolle: 'Officer / Expedition Leader', pattern: /\b(?:Curt|von)\s+Morgen\b/ },
  'Georg August Zenker': { rolle: 'Station Chief Yaoundé', pattern: /\bZenker\b/ },
  'Gustav Conrau': { rolle: 'Merchant / Colonial Agent', pattern: /\bConrau\b/ },
  'J.F.G. Umlauff': { rolle: 'Colonial Trading House Hamburg', pattern: /\bUmlauff\b/ },
  'Hans Dominik': { rolle: 'Major Schutztruppe', pattern: /\bDominik\b/ },
  'Max Buchner': { rolle: 'Consul / Ethnologist', pattern: /\bBuchner\b/ },
  'Harry Rawson': { rolle: 'Admiral / Benin Punitive Expedition 1897', pattern: /\bRawson\b/ },
  'Ralph Moor': { rolle: 'Consul-General Niger Coast Protectorate', pattern: /\bRalph\s+Moor\b/ },
  'W.D. Webster': { rolle: 'Ethnographic Art Dealer (London)', pattern: /\bWebster\b/ },
  'Augustus Pitt Rivers': { rolle: 'General & Collector', pattern: /\bPitt[\s-]+Rivers\b/ },
  'Alfred Dodds': { rolle: 'Général / Dahomey Campaign 1892', pattern: /\bDodds\b/ },
  'Marcel Griaule': { rolle: 'Leader Mission Dakar-Djibouti (1931–1933)', pattern: /\bGriaule\b/ },
  'Lothar von Trotha': { rolle: 'Commander Schutztruppe GSWA', pattern: /\bTrotha\b/ },
  'Robert Napier': { rolle: 'Commander Maqdala Expedition 1868', pattern: /\bNapier\b/ },
  'Garnet Wolseley': { rolle: 'Commander Anglo-Asante War 1874', pattern: /\bWolseley\b/ },
};

const KNOWN_INSTITUTIONS: Record<string, { stadt: string; kuerzel: string }> = {
  'Ethnologisches Museum Berlin': { stadt: 'Berlin', kuerzel: 'EM' },
  'Museum für Völkerkunde zu Leipzig': { stadt: 'Leipzig', kuerzel: 'Grassimuseum' },
  'Linden-Museum Stuttgart': { stadt: 'Stuttgart', kuerzel: 'LM' },
  'Museum Fünf Kontinente München': { stadt: 'München', kuerzel: 'MFK' },
  'Übersee-Museum Bremen': { stadt: 'Bremen', kuerzel: 'ÜM' },
  'Museum am Rothenbaum (MARKK)': { stadt: 'Hamburg', kuerzel: 'MARKK' },
  'Museum für Völkerkunde Dresden': { stadt: 'Dresden', kuerzel: 'SES' },
  'Rautenstrauch-Joest-Museum Köln': { stadt: 'Köln', kuerzel: 'RJM' },
  'Weltkulturen Museum Frankfurt': { stadt: 'Frankfurt', kuerzel: 'WMF' },
  'British Museum': { stadt: 'London', kuerzel: 'BM' },
  'Pitt Rivers Museum': { stadt: 'Oxford', kuerzel: 'PRM' },
  'Victoria and Albert Museum': { stadt: 'London', kuerzel: 'V&A' },
  'Musée du quai Branly': { stadt: 'Paris', kuerzel: 'MQB' },
  'AfricaMuseum Tervuren': { stadt: 'Tervuren', kuerzel: 'RMCA' },
  'Weltmuseum Wien': { stadt: 'Wien', kuerzel: 'WMW' },
  'Wereldmuseum Leiden': { stadt: 'Leiden', kuerzel: 'NMVW' },
  'Metropolitan Museum of Art': { stadt: 'New York', kuerzel: 'MET' },
};

const ORIGIN_COMMUNITIES: Array<[string, RegExp]> = [
  ['Kingdom of Benin (Edo)', /\b(?:Benin(?:\s+City|\s+Bronz|\s+Kingdom|\s+Punitive|\s+1897)|Edo\s+Court|Oba\s+Ovonramwen)\b/i],
  ['Asante (Ghana)', /\b(?:Asante|Ashanti|Kumasi|Manhyia)\b/i],
  ['Kingdom of Dahomey (Fon)', /\b(?:Dahomey|Abomey|Béhanzin|Behanzin)\b/i],
  ['Nso (Cameroon)', /\b(?:Nso|Kumbo|Kimbo|Ngonnso)\b/i],
  ['Bamum (Cameroon)', /\b(?:Bamum|Bamun|Bamoun|Foumban|Njoya)\b/i],
  ['Bafut (Cameroon)', /\b(?:Bafut)\b/i],
  ['Duala (Cameroon)', /\b(?:Duala|Douala|Hickorytown|Bele-Bele)\b/i],
  ['Ovaherero & Nama (Namibia)', /\b(?:Herero|Ovaherero|Nama|Witbooi|Südwestafrika)\b/i],
  ['Maji-Maji / Wahehe (Tanzania)', /\b(?:Maji[\s-]Maji|Wahehe|Mkwawa|Deutsch-Ostafrika)\b/i],
  ['Maqdala (Ethiopia)', /\b(?:Maqdala|Magdala|Tewodros)\b/i],
  ['Kongo / Loango', /\b(?:Kingdom\s+of\s+Kongo|Loango|Luba|Kuba|Bakongo)\b/i],
  ['Rapa Nui / Oceania', /\b(?:Rapa\s+Nui|Hoa\s+Hakananai|Bismarck-Archipel|Luf-Boot|Maori|Aotearoa)\b/i],
];

function inferDepotFromPrefix(inv: string): [string, string] | null {
  const u = inv.trim();
  if (/^(?:Af|Am|Oc|As|Eu)\d{4},/.test(u)) return ['British Museum', 'London'];
  if (/^7[01]\.\d{4}\./.test(u)) return ['Musée du quai Branly', 'Paris'];
  if (/^(?:EO\.0\.|RG )/i.test(u)) return ['AfricaMuseum Tervuren', 'Tervuren'];
  if (/^(?:III\s*[CEAF]|VI\s+\d)/i.test(u)) return ['Ethnologisches Museum Berlin', 'Berlin'];
  if (/^VK/i.test(u)) return ['Linden-Museum Stuttgart', 'Stuttgart'];
  if (/^C[\s_]/i.test(u)) return ['Museum am Rothenbaum (MARKK)', 'Hamburg'];
  return null;
}

function inferObjectDesc(tLow: string, community: string | null): string {
  const map: Array<[string[], string]> = [
    [['bronze plaque', 'reliefplatte', 'benin bronze', 'plaque'], 'Cast Bronze Relief Plaque'],
    [['ivory tusk', 'elfenbein', 'stoßzahn', 'ivoire'], 'Carved Ivory Heritage Object'],
    [['commemorative head', 'gedenkkopf', 'uhunmwun', 'tête commémorative'], 'Royal Commemorative Head'],
    [['trommel', 'slit drum', 'drum', 'tambour'], 'Ceremonial Drum'],
    [['thron', 'throne', 'stool', 'trône'], 'Royal Throne / Seat of Authority'],
    [['maske', 'mask', 'masque'], 'Ritual Mask'],
    [['figur', 'figure', 'statue', 'ahnenfigur', 'nkisi', 'reliquary', 'récade'], 'Sacred Sculpture / Royal Regalia'],
    [['pfeife', 'pipe'], 'Ceremonial Pipe'],
    [['manuskript', 'manuscript', 'tabot'], 'Sacred Manuscript / Cult Object'],
  ];
  for (const [keys, label] of map) {
    if (keys.some((k) => tLow.includes(k))) {
      return community ? `${label} (${community})` : label;
    }
  }
  return community ? `Cultural Heritage Object (${community})` : 'Colonial Cultural Heritage Object';
}

export function parseSourceTextInBrowser(rawText: string, docName = 'Archival_Excerpt.txt'): {
  triples: ExtractedTriple[];
  inventories: string[];
  actors: string[];
  institutions: string[];
  communities: string[];
  collisions: number;
} {
  const blocks = rawText
    .split(/\f|\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 12);
  const chunks = blocks.length > 0 ? blocks : (rawText.trim() ? [rawText.trim()] : []);

  const allTriples: ExtractedTriple[] = [];
  const allInvs = new Set<string>();
  const allActors = new Set<string>();
  const allInsts = new Set<string>();
  const allComms = new Set<string>();
  let collisions = 0;

  const invPatterns = [
    /\b(?:Af|Am|Oc|As|Eu)\d{4},\d{3,5}\.\d+[a-z]?\b/g,
    /\b7[01]\.\d{4}\.\d+\.\d+(?:\.\d+)?\b/g,
    /\bEO\.0\.0\.\d{3,6}\b/g,
    /\b(?:III|IV|V|VI)\s*[A-Z]\s*\d+(?:[\/a-zA-Z0-9-]+)?\b/g,
    /\b(?:VK|MAf|IM|EA|USNM)\s*[\.-]?\s*\d{3,7}(?:[\.-]\d+)?\b/g,
    /\b(?:Inv\.?-?\s*Nr\.?|Acc\.?\s*No\.?|Cat\.?\s*No\.?|Obj\.?-?\s*Nr\.?)\s*[A-Za-z0-9\.,\/-]{2,20}\b/g,
    /\b[A-Z]{1,2}\s*\d{4,6}\b/g,
    /\b\d{4}\.\d{2,4}\.\d{1,4}\b/g,
  ];

  const dynActorRe = /\b(Hauptmann|Oberleutnant|Leutnant|Major|Oberst|General|Gouverneur|Konsul|Admiral|Captain|Capt\.|Colonel|Col\.|Brigadier|Sir|Governor|Consul|Commander|Commandant|Capitaine|Général|Dr\.|Prof\.)\s+([A-ZÄÖÜÉÈ][a-zäöüßéèê\-]+(?:\s+(?:von|van|de|du|[A-ZÄÖÜÉÈ]\.)\s*[A-ZÄÖÜÉÈ][a-zäöüßéèê\-]+|\s+[A-ZÄÖÜÉÈ][a-zäöüßéèê\-]+){0,2})/g;

  chunks.forEach((chunk, idx) => {
    const beleg = `${docName}, § ${idx + 1}`;
    const cleanInvs = new Set<string>();
    for (const pat of invPatterns) {
      const matches = chunk.match(pat) || [];
      for (const m of matches) {
        const c = m.replace(/\s+/g, ' ').replace(/^[ .,;:]+|[ .,;:]+$/g, '');
        if (!/^\d{5}$/.test(c) && !c.startsWith('978') && c.length >= 4) {
          cleanInvs.add(c);
          allInvs.add(c);
        }
      }
    }

    const foundActors: Array<{ name: string; rolle: string }> = [];
    const seenAct = new Set<string>();
    for (const [name, meta] of Object.entries(KNOWN_ACTORS)) {
      if (meta.pattern.test(chunk)) {
        foundActors.push({ name, rolle: meta.rolle });
        seenAct.add(name.toLowerCase());
        allActors.add(name);
      }
    }
    for (const m of chunk.matchAll(dynActorRe)) {
      const roleWord = m[1].trim();
      const person = m[2].trim();
      if (person.length >= 4 && !['museum', 'university', 'collection', 'berlin', 'london', 'paris'].includes(person.toLowerCase())) {
        if (!Array.from(seenAct).some((s) => s.includes(person.toLowerCase()) || person.toLowerCase().includes(s))) {
          foundActors.push({ name: person, rolle: `Historical Actor (${roleWord})` });
          seenAct.add(person.toLowerCase());
          allActors.add(person);
        }
      }
    }

    const foundInsts: Array<{ name: string; stadt: string }> = [];
    for (const [instName, meta] of Object.entries(KNOWN_INSTITUTIONS)) {
      const kRe = new RegExp(`\\b${meta.kuerzel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (
        chunk.includes(instName) ||
        kRe.test(chunk) ||
        (chunk.includes(meta.stadt) && /(Museum|Musée|Sammlung|Collection)/i.test(chunk))
      ) {
        foundInsts.push({ name: instName, stadt: meta.stadt });
        allInsts.add(instName);
      }
    }

    let community: string | null = null;
    for (const [cname, cre] of ORIGIN_COMMUNITIES) {
      if (cre.test(chunk)) {
        community = cname;
        allComms.add(cname);
        break;
      }
    }

    const tLow = chunk.toLowerCase();
    const isRaub = ['raub', 'geplündert', 'plünderten', 'kriegsbeute', 'strafexpedition', 'strafzug', 'punitive expedition', 'loot', 'looted', 'plundered', 'captured', 'sacked', 'pillaged', 'spoils of war', 'seized during', 'pillage', 'pillé', 'butin', 'expédition punitive', 'prise de guerre'].some((w) => tLow.includes(w));
    const isEnteignung = ['enteignung', 'angeeignet', 'erzwungen', 'beschlagnahmt', 'confiscated', 'expropriated', 'coerced', 'duress', 'tribute', 'confisqué', 'extorqué', 'réquisition'].some((w) => tLow.includes(w));
    const isSale = ['verkauft', 'ankauf', 'auktion', 'sold', 'purchased', 'auction', 'vendu', 'acheté', 'vente'].some((w) => tLow.includes(w));
    const isGift = ['schenkung', 'geschenk', 'donated', 'gift of', 'bequeathed', 'presented by', 'don de', 'legs'].some((w) => tLow.includes(w));

    const yearMatch = chunk.match(/\b(18[5-9]\d|19[0-5]\d)\b/);
    const eventYear = yearMatch ? Number(yearMatch[1]) : null;
    const objDesc = inferObjectDesc(tLow, community);

    for (const inv of cleanInvs) {
      const inferred = inferDepotFromPrefix(inv);
      const inst = foundInsts[0] || (inferred ? { name: inferred[0], stadt: inferred[1] } : null);
      if (inst) {
        allInsts.add(inst.name);
        allTriples.push({
          source: inv,
          source_label: inv,
          source_type: 'Subjekt',
          source_desc: objDesc,
          target: inst.name,
          target_label: inst.name,
          target_type: 'Institution',
          target_desc: inst.stadt,
          type: 'LAGERT_IN',
          beleg,
          jahr: eventYear,
          kollision: false,
          narrativ: 'FORENSISCHE_REALITAET',
          herkunft: community || undefined,
          paragraph_index: idx,
          source_excerpt: chunk,
          zitat: chunk,
        });
      }

      if (foundActors.length > 0) {
        const act = foundActors[0];
        const relType = isRaub
          ? 'RAUBTE'
          : isEnteignung
            ? 'ENTEIGNETE'
            : isSale
              ? 'VERKAUFTE_AN'
              : isGift
                ? 'SCHENKTE'
                : 'EIGNETE_SICH_AN';

        const hasCollision = (isRaub || isEnteignung) && (isGift || isSale);
        allTriples.push({
          source: act.name,
          source_label: act.name,
          source_type: 'Akteur',
          source_desc: act.rolle,
          target: inv,
          target_label: inv,
          target_type: 'Subjekt',
          target_desc: objDesc,
          type: relType,
          beleg,
          jahr: eventYear,
          kollision: hasCollision,
          narrativ: 'FORENSISCHE_REALITAET',
          herkunft: community || undefined,
          paragraph_index: idx,
          source_excerpt: chunk,
          zitat: chunk,
        });

        if (hasCollision) {
          collisions++;
          const claimActor = foundActors[1]?.name || act.name;
          const claimRel = isGift ? 'SCHENKTE' : 'VERKAUFTE_AN';
          allTriples.push({
            source: claimActor,
            source_label: claimActor,
            source_type: 'Akteur',
            source_desc: foundActors[1]?.rolle || 'Dealer / Donor (Claimed)',
            target: inv,
            target_label: inv,
            target_type: 'Subjekt',
            target_desc: objDesc,
            type: claimRel,
            beleg,
            jahr: eventYear,
            kollision: true,
            narrativ: 'MUSEUMS_NARRATIV',
            herkunft: community || undefined,
            paragraph_index: idx,
            source_excerpt: chunk,
            zitat: chunk,
          });
        }
      }
    }
  });

  return {
    triples: allTriples,
    inventories: Array.from(allInvs),
    actors: Array.from(allActors),
    institutions: Array.from(allInsts),
    communities: Array.from(allComms),
    collisions,
  };
}

const LOOT_SIGNAL_WORDS = [
  'punitive expedition', 'spoils of war', 'seized during', 'expédition punitive', 'prise de guerre',
  'strafexpedition', 'kriegsbeute', 'brandschatzung', 'geplündert', 'plünderten', 'beschlagnahmt',
  'enteignung', 'angeeignet', 'erzwungen', 'strafzug', 'looted', 'plundered', 'captured',
  'pillaged', 'confiscated', 'expropriated', 'coerced', 'sacked', 'pillage', 'confisqué',
  'extorqué', 'réquisition', 'saisis', 'saisi', 'butin', 'pillé', 'raub', 'loot',
];

const DONATION_SIGNAL_WORDS = [
  'donated', 'gift of', 'bequeathed', 'presented by', 'purchased', 'auction',
  'schenkung', 'geschenk', 'geschenkt', 'verkauft', 'ankauf', 'auktion',
  'don de', 'vendu', 'acheté', 'vente', 'legs', 'sold',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Produces non-overlapping inline highlight segments so the Document Reader shows
 * the exact words/tokens from which objects, actors, depots, loot signals, and donation claims were extracted.
 */
export function highlightArchivalText(text: string): TextHighlightSpan[] {
  if (!text) return [];
  const candidates: Array<{ start: number; end: number; kind: HighlightKind; prio: number }> = [];

  const addMatches = (re: RegExp, kind: HighlightKind, prio: number) => {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const gRe = new RegExp(re.source, flags);
    for (const m of text.matchAll(gRe)) {
      if (m.index === undefined || !m[0]) continue;
      candidates.push({ start: m.index, end: m.index + m[0].length, kind, prio });
    }
  };

  // 1. Inventory numbers / objects (highest priority)
  [
    /\b(?:Af|Am|Oc|As|Eu)\d{4},\d{3,5}\.\d+[a-z]?\b/g,
    /\b7[01]\.\d{4}\.\d+\.\d+(?:\.\d+)?\b/g,
    /\bEO\.0\.0\.\d{3,6}\b/g,
    /\b(?:III|IV|V|VI)\s*[A-Z]\s*\d+(?:[\/a-zA-Z0-9-]+)?\b/g,
    /\b(?:VK|MAf|IM|EA|USNM)\s*[\.-]?\s*\d{3,7}(?:[\.-]\d+)?\b/g,
    /\b(?:Inv\.?-?\s*Nr\.?|Acc\.?\s*No\.?|Cat\.?\s*No\.?|Obj\.?-?\s*Nr\.?)\s*[A-Za-z0-9\.,\/-]{2,20}\b/g,
  ].forEach((p) => addMatches(p, 'object', 6));

  // 2. Institutions / Depots
  for (const instName of Object.keys(KNOWN_INSTITUTIONS)) {
    addMatches(new RegExp(escapeRegExp(instName), 'gi'), 'depot', 5);
  }

  // 3. Known & titled colonial actors
  for (const [actName, meta] of Object.entries(KNOWN_ACTORS)) {
    addMatches(new RegExp(escapeRegExp(actName), 'gi'), 'actor', 5);
    addMatches(meta.pattern, 'actor', 4);
  }
  addMatches(
    /\b(?:Hauptmann|Oberleutnant|Leutnant|Major|Oberst|General|Gouverneur|Konsul|Admiral|Captain|Colonel|Brigadier|Governor|Consul|Commander|Commandant|Capitaine|Général)\s+[A-ZÄÖÜÉÈ][a-zäöüßéèê\-]+(?:\s+(?:von|van|de|du|[A-ZÄÖÜÉÈ]\.)\s*[A-ZÄÖÜÉÈ][a-zäöüßéèê\-]+|\s+[A-ZÄÖÜÉÈ][a-zäöüßéèê\-]+)?/g,
    'actor',
    4,
  );

  // 4. Loot & Donation legal-signal triggers
  addMatches(new RegExp(`\\b(?:${LOOT_SIGNAL_WORDS.map(escapeRegExp).join('|')})\\b`, 'gi'), 'loot', 4);
  addMatches(new RegExp(`\\b(?:${DONATION_SIGNAL_WORDS.map(escapeRegExp).join('|')})\\b`, 'gi'), 'donation', 4);

  // 5. Origin communities
  for (const [, cre] of ORIGIN_COMMUNITIES) {
    addMatches(cre, 'community', 3);
  }

  candidates.sort((a, b) => a.start - b.start || b.prio - a.prio || (b.end - b.start) - (a.end - a.start));
  const accepted: typeof candidates = [];
  let cursor = 0;
  for (const c of candidates) {
    if (c.start >= cursor) {
      accepted.push(c);
      cursor = c.end;
    }
  }

  const out: TextHighlightSpan[] = [];
  let pos = 0;
  for (const seg of accepted) {
    if (seg.start > pos) {
      out.push({ text: text.slice(pos, seg.start), kind: null });
    }
    out.push({ text: text.slice(seg.start, seg.end), kind: seg.kind });
    pos = seg.end;
  }
  if (pos < text.length) {
    out.push({ text: text.slice(pos), kind: null });
  }
  return out;
}

export const SAMPLE_ARCHIVAL_EXCERPTS = [
  {
    id: 'sample_benin_en',
    lang: 'EN',
    title: 'Benin Punitive Expedition 1897 (British Museum)',
    filename: 'Benin_1897_Archival_Excerpt.txt',
    text: 'During the Benin Punitive Expedition of 1897 commanded by Admiral Harry Rawson, royal bronze plaque Af1897,0511.1 and carved ivory tusk Af1897,0511.2 were looted from the Edo Court in Benin City. The objects were later recorded in the British Museum as donated by W.D. Webster.',
  },
  {
    id: 'sample_dahomey_fr',
    lang: 'FR',
    title: 'Campagne du Dahomey 1892 (Musée du quai Branly)',
    filename: 'Dahomey_1892_Extrait_Archive.txt',
    text: "À l'issue de la prise d'Abomey en 1892 par le Général Alfred Dodds (Royaume du Dahomey), le trône royal et la statue 71.1892.34.1 ont été saisis comme prise de guerre (butin) puis transférés comme don de l'armée au Musée du quai Branly à Paris.",
  },
  {
    id: 'sample_cameroon_de',
    lang: 'DE',
    title: 'Kamerun Strafexpedition 1902 (Ethnologisches Museum)',
    filename: 'Kamerun_1902_Aktenauszug.txt',
    text: 'Im Zuge der Strafexpedition gegen Nso und Bafut (1902) unter Hauptmann Curt von Pavel wurde die Zeremonialtrommel III C 15099 als Kriegsbeute geplündert. Im Zugangsbuch des Ethnologischen Museums Berlin erscheint das Objekt später als Schenkung.',
  },
];
