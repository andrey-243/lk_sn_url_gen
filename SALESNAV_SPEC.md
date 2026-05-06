# Sales Navigator Query Generator — Spec pour Claude Code

## Objectif

Outil web (HTML statique ou Next.js) qui génère des query strings Sales Navigator
à coller dans Captain Data (`/people/search?query=`).
L'utilisateur choisit un pays, une langue, un type de cible → la query est générée automatiquement.

---

## Structure de la query string (reverse-engineered depuis Evaboot)

```
(spellCorrectionEnabled:true,filters:List((type:REGION,values:List((id:{GEO_ID},text:{GEO_ID},selectionType:INCLUDED))),(type:CURRENT_TITLE,values:List((text:{BOOLEAN_TITLE_STRING},selectionType:INCLUDED)))),keywords:{KEYWORDS_STRING})
```

### Règles de construction

- `spellCorrectionEnabled:true` → toujours présent
- `recentSearchParam` → ignorer, inutile pour Captain Data
- `sessionId` → ignorer
- `type:REGION` → le champ `text:` répète l'ID numérique (pas le nom lisible)
- `type:CURRENT_TITLE` → une seule entrée, avec Boolean complexe dans `text:`
- `keywords` → OR-list de termes métier contextuels au pays/langue

---

## IDs géographiques (type:REGION)

| Zone | ID |
|---|---|
| Suisse (pays entier) | `106693272` |
| France (pays entier) | `105015875` |
| Genève (canton) | `100878084` |
| Zürich (canton) | `100878351` |
| Vaud (canton) | `103757379` |
| Belgique | `100565514` |
| Allemagne | `101282230` |

---

## UI — Dropdowns

### Dropdown 1 : Pays
- Suisse
- France
- Belgique
- Allemagne

### Dropdown 2 : Langue
Dépend du pays sélectionné :
- Suisse → FR / DE / IT / EN
- France → FR
- Belgique → FR / NL
- Allemagne → DE

### Dropdown 3 : Type de cible
- Agents immobiliers
- Dirigeants d'agences (directeurs, gérants, fondateurs)
- Cabinets / Sociétés immobilières

### Dropdown 4 : Zone géographique (canton / région)
- "Tout le pays" (défaut)
- IDs hardcodés affichés en premier (Genève, Zürich)
- IDs appris via LLM affichés ensuite avec badge "IA" + indicateur confiance (✓ = high / ~ = low)
- Champ texte libre pour saisir une zone inconnue
  - Mode statique → message "Zone non reconnue — activez le mode LLM"
  - Mode LLM → le LLM tente de résoudre l'ID et le stocke automatiquement

### IDs géo hardcodés (cantons/régions)

| Pays | Zone | ID |
|---|---|---|
| Suisse | Genève | `100878084` |
| Suisse | Zürich | `100878351` |

### IDs appris dynamiquement (localStorage `salesnav_geo_ids`)

```javascript
{
  "vaud": { "id": "103757379", "confidence": "high", "source": "llm", "timestamp": 1234567890 },
  "berne": { "id": "XXXXX", "confidence": "low", "source": "llm", "timestamp": 1234567890 },
  "ile-de-france": { "id": "XXXXX", "confidence": "high", "source": "llm", "timestamp": 1234567890 }
}
```

### Logique de résolution géo

```javascript
function resolveGeoId(zone) {
  // 1. Check hardcodé
  if (HARDCODED_GEO_IDS[zone]) return { id: HARDCODED_GEO_IDS[zone], confidence: "high" }

  // 2. Check localStorage appris
  const learned = JSON.parse(localStorage.getItem("salesnav_geo_ids") || "{}")
  if (learned[zone]) return learned[zone]

  // 3. Mode statique → bloquer
  if (!llmMode) return { id: null, error: "Zone inconnue — activez le mode LLM" }

  // 4. Mode LLM → laisser le LLM résoudre
  return { id: null, needsLLM: true }
}
```

### Stockage automatique des IDs découverts par LLM

```javascript
function storeGeoId(geoName, geoId, confidence) {
  const learned = JSON.parse(localStorage.getItem("salesnav_geo_ids") || "{}")
  // Ne pas écraser un "high" avec un "low"
  if (learned[geoName]?.confidence === "high" && confidence === "low") return
  learned[geoName] = { id: geoId, confidence, source: "llm", timestamp: Date.now() }
  localStorage.setItem("salesnav_geo_ids", JSON.stringify(learned))
}
```

### Instruction ajoutée au system prompt LLM pour la géo

```
Si la zone demandée n'est pas dans la liste des IDs connus, tente d'estimer l'ID LinkedIn.
Pattern cantons suisses : 100878XXX
Pattern régions françaises : 10XXXXXXX
Renvoie toujours :
- "geo_id": l'ID estimé ou connu
- "geo_confidence": "high" si ID connu avec certitude, "low" si estimé
- "geo_name": nom normalisé en minuscules sans accents (ex: "vaud", "ile-de-france")
```

### Toggle : Exclure juniors/stagiaires
- ON par défaut → ajoute la liste d'exclusion étendue
- OFF → liste d'exclusion minimale

---

## Enrichissement dynamique des templates

Chaque fois qu'une query est générée via LLM, les termes sont extraits et stockés pour enrichir les templates statiques.

### Clés localStorage

```javascript
// Titres appris par langue + type de cible
"salesnav_titles": {
  "fr:agents":     { "include": ["Agent", "Conseiller", ...], "sector": ["Immobilier", ...], "exclude": ["Stagiaire", ...] },
  "fr:dirigeants": { "include": ["Directeur", "Gérant", ...], "sector": ["Agence", ...], "exclude": ["Adjoint", ...] },
  "de:dirigeants": { "include": ["Geschäftsführer", ...], "sector": ["Immobilien", ...], "exclude": ["Praktikant", ...] },
  "it:dirigeants": { "include": ["Direttore", ...], "sector": ["Immobiliare", ...], "exclude": ["Stagista", ...] }
}

// Keywords métier appris par pays + langue + zone
"salesnav_keywords": {
  "ch:fr":    ["MLS", "CECB", "PPE", ...],
  "ch:fr:ge": ["Permis G", "CGCI", "million CHF", ...],
  "ch:de":    ["Makler", "GEAK", "Stockwerkeigentum", ...],
  "ch:it":    ["mediatore", "compravendita", ...],
  "fr:fr":    ["FNAIM", "DPE", "Loi Carrez", ...]
}
```

### Instruction ajoutée au system prompt LLM

```
À la fin de ta réponse JSON, inclus toujours :
- "title_includes": termes positifs du CURRENT_TITLE (partie gauche du AND)
- "title_sector": termes secteur du CURRENT_TITLE (partie droite du AND)
- "title_excludes": termes du NOT
- "keywords_used": keywords métier utilisés
- "template_key": clé langue+type ex: "fr:agents", "de:dirigeants"
- "keywords_key": clé contexte ex: "ch:fr", "ch:fr:ge", "fr:fr"
```

### Fusion avec les templates statiques

```javascript
function mergeToTemplates(llmResponse) {
  // Titres
  const titles = JSON.parse(localStorage.getItem("salesnav_titles") || "{}")
  const key = llmResponse.template_key
  if (!titles[key]) titles[key] = { include: [], sector: [], exclude: [] }

  llmResponse.title_includes.forEach(t => { if (!titles[key].include.includes(t)) titles[key].include.push(t) })
  llmResponse.title_sector.forEach(t => { if (!titles[key].sector.includes(t)) titles[key].sector.push(t) })
  llmResponse.title_excludes.forEach(t => { if (!titles[key].exclude.includes(t)) titles[key].exclude.push(t) })
  localStorage.setItem("salesnav_titles", JSON.stringify(titles))

  // Keywords
  const kw = JSON.parse(localStorage.getItem("salesnav_keywords") || "{}")
  const kwKey = llmResponse.keywords_key
  if (!kw[kwKey]) kw[kwKey] = []
  llmResponse.keywords_used.forEach(k => { if (!kw[kwKey].includes(k)) kw[kwKey].push(k) })
  localStorage.setItem("salesnav_keywords", JSON.stringify(kw))
}
```

### Utilisation en mode statique (après apprentissage)

```javascript
function buildTitleString(lang, type) {
  const hardcoded = HARDCODED_TITLES[lang][type]
  const learned = JSON.parse(localStorage.getItem("salesnav_titles") || "{}")[`${lang}:${type}`] || {}

  const include = [...new Set([...hardcoded.include, ...(learned.include || [])])]
  const sector  = [...new Set([...hardcoded.sector,  ...(learned.sector  || [])])]
  const exclude = [...new Set([...hardcoded.exclude,  ...(learned.exclude || [])])]

  return `(${include.map(t => `"${t}"`).join(" OR ")}) AND (${sector.map(t => `"${t}"`).join(" OR ")}) NOT (${exclude.join(" OR ")})`
}

function buildKeywords(country, lang, zone) {
  const key = zone ? `${country}:${lang}:${zone}` : `${country}:${lang}`
  const hardcoded = HARDCODED_KEYWORDS[key] || HARDCODED_KEYWORDS[`${country}:${lang}`] || []
  const learned = JSON.parse(localStorage.getItem("salesnav_keywords") || "{}")[key] || []
  return `(${[...new Set([...hardcoded, ...learned])].map(k => `"${k}"`).join(" OR ")})`
}
```

### Onglet "Base apprise"
- Tableau des titres appris par langue/type → possibilité de supprimer des termes individuels
- Tableau des keywords appris par contexte → possibilité de supprimer
- Bouton "Reset tout" pour repartir des templates hardcodés uniquement
- Bouton "Exporter JSON" pour sauvegarder la base apprise

---

## Templates CURRENT_TITLE par langue et type de cible

### AGENTS — Français
```
("Agent" OR "Conseiller" OR "Consultant" OR "Courtier" OR "Négociateur" OR "Négociatrice" OR "Mandataire" OR "Promoteur" OR "Promotrice" OR "Expert") AND ("Immobilier" OR "Real Estate" OR "Immobilière" OR "Immeuble" OR "Immeubles" OR "Foncier" OR "Locatif") NOT (Assistant OR Stagiaire OR Junior OR Coordinateur OR Trainee OR Intern OR "Entry Level")
```

### AGENTS — Allemand
```
("Makler" OR "Maklerin" OR "Immobilienmakler" OR "Immobilienmaklerin" OR "Berater" OR "Beraterin" OR "Immobilienberater" OR "Immobilienberaterin" OR "Käufermakler" OR "Verkäufermakler") AND ("Immobilien" OR "Real Estate" OR "Liegenschaft" OR "Liegenschaften" OR "Immobilienbüro") NOT (Praktikant OR Junior OR Trainee OR Intern)
```

### AGENTS — Italien
```
("Agente" OR "Agente Immobiliare" OR "Consulente" OR "Consulente Immobiliare" OR "Mediatore" OR "Mediatrice" OR "Intermediario" OR "Broker") AND ("Immobiliare" OR "Real Estate" OR "Agenzia" OR "Immobili" OR "Compravendita" OR "Locazione") NOT (Stagista OR Tirocinante OR Junior OR Trainee OR Intern)
```

### AGENTS — Anglais (EN)
```
("Real Estate Agent" OR "Property Agent" OR "Estate Agent" OR "Lettings Agent" OR "Sales Negotiator" OR "Lettings Negotiator" OR "Real Estate Broker" OR "Real Estate Consultant" OR "Real Estate Advisor" OR "Property Advisor" OR "Realtor" OR "Buyer's Agent" OR "Acquisition Agent")
```

### DIRIGEANTS — Français
```
("Directeur" OR "Director" OR "Gérant" OR "Manager" OR "Responsable" OR "Chef" OR "Head" OR "Associé" OR "Partner" OR "Fondateur" OR "Founder" OR "Syndic" OR "Régisseur" OR "Principal" OR "Senior") AND ("Agence" OR "Agency" OR "Bureau" OR "Cabinet" OR "Société" OR "Immobilier" OR "Real Estate" OR "Immobilière" OR "Foncier" OR "Gérance" OR "Copropriété" OR "PPE" OR "Regie") NOT (Assistant OR Stagiaire OR Junior OR Adjoint OR Trainee OR Intern OR "Entry Level")
```

### DIRIGEANTS — Allemand
```
("Geschäftsführer" OR "Direktor" OR "Director" OR "Leiter" OR "Head" OR "Manager" OR "Inhaber" OR "Owner" OR "Partner" OR "Gründer" OR "Founder" OR "Verwalter") AND ("Immobilien" OR "Real Estate" OR "Immobilienmakler" OR "Liegenschaft" OR "Liegenschaften" OR "Immobilienbüro" OR "Hausverwaltung") NOT (Praktikant OR Auszubildender OR Junior OR Koordinator OR Adjunkt OR Trainee OR Intern)
```

### DIRIGEANTS — Italien
```
("Direttore" OR "Director" OR "Responsabile" OR "Manager" OR "Capo" OR "Head" OR "Titolare" OR "Owner" OR "Partner" OR "Socio" OR "Fondatore" OR "Founder" OR "Amministratore") AND ("Immobiliare" OR "Real Estate" OR "Agenzia" OR "Agenzia Immobiliare" OR "Immobili" OR "Patrimonio") NOT (Stagista OR Tirocinante OR Junior OR Coordinatore OR Trainee OR Intern)
```

### DIRIGEANTS — Anglais (EN)
```
("Director" OR "Manager" OR "Head" OR "Owner" OR "Partner" OR "Founder" OR "Principal" OR "Senior") AND ("Real Estate" OR "Property" OR "Agency" OR "Estate Agent" OR "Brokerage") NOT (Assistant OR Junior OR Coordinator OR Trainee OR Intern OR "Entry Level")
```

---

## Liste d'exclusion (NOT) — règle stricte

**Exclusion minimale (toujours appliquée) :**
```
NOT (Assistant OR Junior OR Stagiaire OR Trainee OR Intern)
```

**Exclusion étendue (toggle ON) :**
```
NOT (Assistant OR Stagiaire OR Junior OR Coordinateur OR Adjoint OR Trainee OR Intern OR "Entry Level")
```
→ adapter les termes selon la langue (Praktikant pour DE, Stagista pour IT, etc.)

---

## Keywords par contexte (pays + langue)

### Suisse — Français (général)
```
("MLS" OR "CRM immobilier" OR "REDS" OR "Immostreet" OR "Century 21" OR "Coldwell Banker" OR "RE/MAX" OR "Wüest Partner" OR "courtier" OR "négociation" OR "évaluation" OR "expertise foncière" OR "rendement locatif" OR "plus-value" OR "hypothèque" OR "financement" OR "CECB" OR "certificat énergétique" OR "copropriété" OR "PPE" OR "cadastre" OR "notaire" OR "acte authentique" OR "compromis" OR "mandat exclusif")
```

### Suisse — Genève (canton spécifique)
```
("Permis G" OR "Autorisation CGCI" OR "USPI" OR "SVIT" OR "Chambre Genevoise" OR "transaction immobilière" OR "évaluation immobilière" OR "expertise immobilière" OR "million CHF" OR "millions CHF" OR "Genève immobilier" OR "marché genevois")
```

### Suisse — Allemand
```
("Makler" OR "Bewertung" OR "Schätzung" OR "Liegenschaftshandel" OR "Vermietung" OR "Verwaltung" OR "Hypothek" OR "Finanzierung" OR "GEAK" OR "Energieausweis" OR "Stockwerkeigentum" OR "WEG" OR "Kataster" OR "Notar" OR "Kaufvertrag" OR "Exklusivmandat" OR "SVIT" OR "Liegenschaft")
```

### Suisse — Italien (Tessin)
```
("agenti" OR "mediatore" OR "intermediario" OR "consulente" OR "valutazione" OR "perizia" OR "gestione" OR "amministrazione" OR "compravendita" OR "locazione" OR "affitto" OR "mutuo" OR "finanziamento" OR "APE" OR "certificato energetico" OR "condominio" OR "comproprietà" OR "catasto" OR "notaio" OR "compromesso" OR "mandato esclusivo")
```

### France — Français
```
("FNAIM" OR "CENTURY 21" OR "Orpi" OR "Laforêt" OR "Guy Hoquet" OR "ERA Immobilier" OR "Loi Carrez" OR "DPE" OR "diagnostic" OR "mandat" OR "estimation" OR "négociation" OR "compromis" OR "acte authentique" OR "notaire" OR "copropriété" OR "hypothèque" OR "PTZ" OR "défiscalisation" OR "Pinel" OR "syndic")
```

---

## Logique de génération (pseudo-code)

```
function buildQuery(pays, langue, typeCible, zone, excludeJuniors):

  // 1. Résoudre l'ID géo
  geoId = GEO_IDS[zone || pays]

  // 2. Choisir le template CURRENT_TITLE
  titleTemplate = TITLE_TEMPLATES[typeCible][langue]

  // 3. Appliquer exclusions
  if excludeJuniors:
    titleTemplate += " " + EXCLUSIONS_EXTENDED[langue]
  else:
    titleTemplate += " " + EXCLUSIONS_MINIMAL

  // 4. Choisir les keywords
  keywords = KEYWORDS[pays][langue][zone]

  // 5. Assembler
  query = "(spellCorrectionEnabled:true,"
  query += "filters:List("
  query += "(type:REGION,values:List((id:" + geoId + ",text:" + geoId + ",selectionType:INCLUDED))),"
  query += "(type:CURRENT_TITLE,values:List((text:" + titleTemplate + ",selectionType:INCLUDED)))"
  query += "),"
  query += "keywords:" + keywords
  query += ")"

  return query
```

---

## Ce que l'outil doit afficher

1. Les 4 dropdowns + toggle exclusion
2. La query générée (raw, à copier dans Captain Data)
3. L'URL complète Sales Nav (pour debug/test)
4. Bouton "Copier la query" + "Copier l'URL"

---

## Dropdown Canton / Région

### Comportement
- Apparaît uniquement après sélection d'un pays
- Option "Tout le pays" sélectionnée par défaut
- IDs connus hardcodés → utilisables en mode statique ET LLM
- Cantons/régions inconnus → champ texte libre, **mode LLM requis** (le LLM tente de trouver l'ID ou adapte la query en conséquence)

### IDs cantons/régions connus

| Pays | Zone | ID |
|---|---|---|
| Suisse | Genève | `100878084` |
| Suisse | Zürich | `100878351` |
| Suisse | Vaud | `103757379` |
| France | Île-de-France | à compléter via LLM |
| France | PACA | à compléter via LLM |

### UX
- Si l'utilisateur tape un canton/région inconnu + mode statique → afficher message : "Zone non reconnue — activez le mode LLM pour générer cette query"
- Si mode LLM actif → passer le nom de la zone au LLM qui gère

---

## Mode LLM (optionnel)

### UX
- Toggle "Mode IA" dans l'interface
- À l'activation → modal qui demande :
  - **Provider** : dropdown (Anthropic / OpenAI / Mistral)
  - **Clé API** : champ texte (type password)
- La clé **n'est jamais stockée** — ni localStorage, ni session, ni anywhere
- La clé est utilisée uniquement pour l'appel en cours, puis oubliée
- L'utilisateur doit la resaisir à chaque session

### Appel API selon provider

**Anthropic**
```javascript
fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey, // jamais stocké
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userInput }]
  })
})
```

**OpenAI**
```javascript
fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey // jamais stocké
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userInput }
    ]
  })
})
```

**Mistral**
```javascript
fetch("https://api.mistral.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey // jamais stocké
  },
  body: JSON.stringify({
    model: "mistral-large-latest",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userInput }
    ]
  })
})
```
```

### System prompt LLM
```
Tu es un expert en LinkedIn Sales Navigator pour l'immobilier.
Tu génères des query strings Sales Navigator au format exact suivant :

(spellCorrectionEnabled:true,filters:List((type:REGION,values:List((id:{GEO_ID},text:{GEO_ID},selectionType:INCLUDED))),(type:CURRENT_TITLE,values:List((text:{BOOLEAN_STRING},selectionType:INCLUDED)))),keywords:{KEYWORDS_STRING})

Règles :
- REGION text: répète toujours l'ID numérique, jamais le nom
- CURRENT_TITLE : Boolean complexe dans un seul champ text: avec AND / OR / NOT
- NOT inclut toujours : Junior, Stagiaire/Praktikant/Stagista selon la langue, Trainee, Intern, "Entry Level"
- keywords : termes métier spécifiques au pays ET à la langue (jamais mélanger FR et DE)
- IDs géo : Suisse=106693272, France=105015875, Genève=100878084, Zürich=100878351

IDs géo disponibles :
Suisse=106693272, France=105015875, Genève=100878084, Zürich=100878351, Belgique=100565514, Allemagne=101282230

Réponds UNIQUEMENT avec un JSON :
{"query": "...", "keywords_used": ["mot1", "mot2", ...], "geo_id": "...", "lang": "fr|de|it|en"}
```

### Storage des résultats LLM (pas la clé)

La clé API n'est **jamais** stockée. Seuls les résultats sont persistés.

À chaque génération LLM réussie, sauvegarder en localStorage :
```javascript
const entry = {
  prompt: userInput,
  query: generatedQuery,
  keywords: parsedResponse.keywords_used,
  geo_id: parsedResponse.geo_id,
  lang: parsedResponse.lang,
  provider: selectedProvider, // "anthropic" | "openai" | "mistral"
  timestamp: Date.now()
}

// Ne jamais stocker apiKey dans cette entrée ni ailleurs

const history = JSON.parse(localStorage.getItem("salesnav_results_history") || "[]")
history.push(entry)
localStorage.setItem("salesnav_results_history", JSON.stringify(history))
```

### Onglet "Résultats appris"
- Liste toutes les queries générées par LLM
- Groupées par langue + geo_id
- Chaque entrée affiche : prompt original, query générée, keywords extraits
- Bouton "Réutiliser cette query" → la copie directement
- Bouton "Effacer l'historique"
- Ces keywords enrichissent les templates statiques au fil du temps (manuellement ou automatiquement)

---

## Bugs Evaboot à éviter

- Ne pas mettre des keywords FR sur une zone DE (ex: FNAIM à Zürich)
- Ne pas terminer la liste keywords par un OR sans valeur
- Ne pas mélanger les termes d'exclusion entre langues

---

## Stack suggérée

- HTML statique pur (pas de framework) — deployable sur Vercel/Netlify en drag & drop
- Ou Next.js si on veut ajouter un appel LLM pour les cas non couverts par les templates
- Pas de backend nécessaire — toute la logique est côté client
