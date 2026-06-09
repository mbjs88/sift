// The strict extraction contract. One schema for both YouTube and article
// sources, so downstream storage and RAG never branch on origin.

export interface ExtractedMetadata {
  ingredients: string[];   // raw, lowercased: ["beef shin","gochujang"]
  equipment: string[];     // ["dutch oven","panasonic bread machine"]
}

export interface ExtractedRecipe {
  title: string;
  body: string;            // distilled steps — the signal, not the blog preamble
  metadata: ExtractedMetadata;
}

export interface ExtractedTechnique {
  name: string;            // "reverse sear", "75% hydration"
  body: string;
  metadata: ExtractedMetadata;
}

export interface ExtractedWisdom {
  body: string;            // universal principle, source-agnostic
  metadata: ExtractedMetadata;
}

export interface ExtractionResult {
  recipe: ExtractedRecipe | null;     // a source may carry no discrete recipe
  techniques: ExtractedTechnique[];
  wisdom: ExtractedWisdom[];
}

// Gemini structured-output schema (OpenAPI subset). Keep field-for-field in
// sync with the interfaces above.
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    recipe: {
      type: 'object',
      nullable: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        metadata: metaSchema(),
      },
      required: ['title', 'body', 'metadata'],
    },
    techniques: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          body: { type: 'string' },
          metadata: metaSchema(),
        },
        required: ['name', 'body', 'metadata'],
      },
    },
    wisdom: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          body: { type: 'string' },
          metadata: metaSchema(),
        },
        required: ['body', 'metadata'],
      },
    },
  },
  required: ['techniques', 'wisdom'],
} as const;

function metaSchema() {
  return {
    type: 'object',
    properties: {
      ingredients: { type: 'array', items: { type: 'string' } },
      equipment: { type: 'array', items: { type: 'string' } },
    },
    required: ['ingredients', 'equipment'],
  };
}

export const EXTRACTION_PROMPT = `You sift cooking content into pure signal.
From the provided source (a video or an article), extract:
- recipe: the discrete recipe if one exists, else null. Steps only — discard
  blog preamble, life stories, and SEO filler.
- techniques: reusable methods (e.g. "reverse sear", "75% hydration",
  "temperature control on a kamado"). Each must stand alone, source-agnostic.
- wisdom: universal principles ("salt meat the night before", "rest dough cold
  for flavour"). General, not tied to this one dish.
For every item, fill metadata.ingredients and metadata.equipment with raw,
lowercased nouns mentioned. Use [] when none. Return only the JSON schema.`;
