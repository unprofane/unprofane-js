/**
 * The wire types, spelled out here so the package ships with no runtime
 * dependency. They are the contracts' types (packages/contracts/src/
 * schemas.ts), and types.test.ts holds them to the contracts by assignment
 * in both directions, so a field cannot exist in one and not the other.
 */
export type Context =
  | 'general'
  | 'username'
  | 'display_name'
  | 'comment'
  | 'chat'
  | 'gaming'
  | 'educational'
  | 'creative'
  | 'review'
  | 'custom_text';
export type PolicyPreset = 'kids' | 'teen' | 'standard' | 'strict' | 'casual';
export type PolicyCategory =
  | 'mild_profanity'
  | 'profanity'
  | 'sexual'
  | 'insult'
  | 'slur'
  | 'threat'
  | 'rude'
  | 'sexual_minors'
  | 'self_harm'
  | 'reserved';
export type Action = 'allow' | 'review' | 'block';
export type Mode = 'fast' | 'balanced' | 'thorough';
export type Mask = 'asterisk' | 'first_letter' | 'grawlix' | 'remove';
export type Severity = 'none' | 'mild' | 'moderate' | 'strong' | 'extreme';
export type Category = 'profanity' | 'sexual' | 'insult' | 'slur' | 'threat' | 'reserved';
export type EvasionTag =
  | 'homoglyph'
  | 'zero_width'
  | 'separator'
  | 'leetspeak'
  | 'repeated_chars'
  | 'diacritics'
  | 'mixed_script'
  | 'fullwidth'
  | 'combining_marks'
  | 'phonetic'
  | 'reversed'
  | 'concatenation'
  | 'case_mixing'
  | 'self_censored'
  | 'misspelled'
  | 'spoonerism'
  | 'pun';
export type Language =
  | 'auto'
  | 'en'
  | 'es'
  | 'pt'
  | 'fr'
  | 'de'
  | 'it'
  | 'nl'
  | 'pl'
  | 'tr'
  | 'ru'
  | 'ar'
  | 'he'
  | 'hi'
  | 'id'
  | 'ja'
  | 'zh'
  | 'ko';
/** A preset, a saved policy id (pol_…) or a map of category to action. */
export type Policy = PolicyPreset | string | Partial<Record<PolicyCategory, Action>>;

/** Terms added to the project's lists for one request: up to 50 of each,
 * 64 characters each, read through the same disguises as the text. */
export interface RequestLists {
  allow?: string[] | undefined;
  block?: string[] | undefined;
}

export interface CheckRequest {
  text: string;
  context?: Context;
  policy?: Policy;
  mode?: Mode;
  language?: Language;
  /** Where the readers are, as a two-letter country code (MX, ES, BR): a word
   * rude in some countries and innocent in others is read as theirs reads it. */
  country?: string;
  mask?: Mask;
  /** A dated engine version, such as 2026-09-29. */
  engine?: string;
  lists?: RequestLists;
}

export interface Match {
  start: number;
  end: number;
  text: string;
  normalized: string;
  term_id: string;
  category: Category;
  severity: Severity;
  evasion: EvasionTag[];
}

export interface CheckResponse {
  id: string;
  allowed: boolean;
  action: Action;
  score: number;
  severity: Severity;
  categories: Record<PolicyCategory, number>;
  obfuscated: boolean;
  evasion: EvasionTag[];
  matches: Match[];
  censored: string;
  /** Why the action is what it is, in a sentence written from the matches
   * and the policy's decision. For people reading a log, not for parsing. */
  reason: string;
  language: { detected: string; confidence: number };
  engine: { version: string; route: 'rules' | 'model' | 'cache'; degraded: boolean };
  timing_ms: number;
}

export interface BatchItem {
  id: string;
  text: string;
  context?: Context;
  policy?: Policy;
}
export interface BatchRequest {
  items: BatchItem[];
  context?: Context;
  policy?: Policy;
  mode?: Mode;
  language?: Language;
  country?: string;
  mask?: Mask;
  engine?: string;
  lists?: RequestLists;
}
export type BatchResult =
  | { id: string; result: CheckResponse }
  | { id: string; error: { type: string; title: string; detail?: string } };
export interface BatchResponse {
  results: BatchResult[];
  counted: number;
}

export interface FeedbackRequest {
  check_id: string;
  verdict: 'false_positive' | 'false_negative' | 'correct';
  expected_action?: Action;
  note?: string;
  /** Stored with the account only when sent, deleted with the account. */
  text?: string;
}
export interface FeedbackResponse {
  id: string;
  received: boolean;
}

export interface UsageResponse {
  period: { start: string; end: string };
  plan: string;
  checks: number;
  included: number | null;
  overage: number;
  routes: { rules: number; model: number; cache: number };
  degraded: number;
}

export type ListKind = 'allow' | 'block' | 'reserved';
export interface List {
  kind: ListKind;
  terms: string[];
  version: number;
}

/** RFC 9457 problem details, as every failure is answered. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  retry_after?: number;
}
