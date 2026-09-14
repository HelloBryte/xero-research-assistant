import { tokenize } from './retrieve.js';

/**
 * A passage as the model was shown it: the text, its heading, and the metadata
 * the application attached to it. The metadata counts as evidence too — the
 * retrieval date, region and currency are supplied by the application, and an
 * answer is asked to repeat them.
 */
export interface CitedPassage {
  text: string;
  heading?: string | null;
  context?: string;
}

export type ClaimVerdict = 'supported' | 'weak' | 'unsupported' | 'uncited';

export interface ClaimCheck {
  verdict: ClaimVerdict;
  /** Share of the claim's content words that appear in the cited passages. */
  overlap: number;
  /** Figures quoted in the claim that were found in the cited passages. */
  matchedFigures: string[];
  /** Figures quoted in the claim that the cited passages do not contain. */
  missingFigures: string[];
  reason: string;
}

const SUPPORTED_OVERLAP = 0.6;
const WEAK_OVERLAP = 0.35;

/**
 * Check that a cited passage actually contains the claim, rather than merely
 * looking plausible next to it.
 *
 * Two signals, both computed by application code and never by the model:
 *
 *  - every figure quoted in the claim must appear in a cited passage. Pricing,
 *    plan limits and dates are exactly where a fluent model invents detail, and
 *    a number is either in the evidence or it is not.
 *  - the claim's content words must overlap the cited text. This catches a
 *    citation attached to the wrong passage.
 *
 * This is a cheap check, not entailment: it rules out fabricated figures and
 * mismatched citations, and it cannot detect a claim that reverses the meaning
 * of the evidence it cites. Verdicts are reported, never silently corrected.
 */
export function checkClaim(claim: string, citedChunks: CitedPassage[]): ClaimCheck {
  if (citedChunks.length === 0) {
    return {
      verdict: 'uncited',
      overlap: 0,
      matchedFigures: [],
      missingFigures: [],
      reason: 'The claim carries no citation.',
    };
  }

  // Models routinely write their citation inline ("... for CA$75 million (E5)").
  // Those labels are the application's own bookkeeping, not figures or words
  // that the evidence has to contain, so they come out before comparison.
  const claimText = stripEvidenceLabels(claim);

  const evidenceText = citedChunks
    .map((chunk) => `${chunk.heading ?? ''} ${chunk.context ?? ''} ${chunk.text}`)
    .join('\n');
  const evidenceFigures = new Set(extractFigures(evidenceText));
  const claimFigures = [...new Set(extractFigures(claimText))];

  const matchedFigures = claimFigures.filter((figure) => evidenceFigures.has(figure));
  const missingFigures = claimFigures.filter((figure) => !evidenceFigures.has(figure));

  const claimTerms = [...new Set(tokenize(claimText))];
  const evidenceTerms = new Set(tokenize(evidenceText));
  const shared = claimTerms.filter((term) => evidenceTerms.has(term));
  const overlap = claimTerms.length === 0 ? 0 : shared.length / claimTerms.length;

  if (missingFigures.length > 0) {
    return {
      verdict: 'unsupported',
      overlap,
      matchedFigures,
      missingFigures,
      reason: `The cited evidence does not contain: ${missingFigures.join(', ')}.`,
    };
  }
  if (overlap >= SUPPORTED_OVERLAP) {
    return {
      verdict: 'supported',
      overlap,
      matchedFigures,
      missingFigures,
      reason: 'The cited evidence contains the claim’s figures and most of its wording.',
    };
  }
  if (overlap >= WEAK_OVERLAP) {
    return {
      verdict: 'weak',
      overlap,
      matchedFigures,
      missingFigures,
      reason: 'The cited evidence is related but only partly matches the wording of the claim.',
    };
  }
  return {
    verdict: 'unsupported',
    overlap,
    matchedFigures,
    missingFigures,
    reason: 'The cited evidence has little in common with the claim.',
  };
}

/** Remove inline evidence references such as "(E1)" or "(E1, E3)". */
export function stripEvidenceLabels(text: string): string {
  return text
    .replace(/\bE\d+\b/g, ' ')
    .replace(/\(\s*[,;\s]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull comparable figures out of text: "$14.30", "1,000", "90%", "2006".
 * Ordinal-style suffixes and currency symbols are dropped so "A$143" and
 * "$143 per month" compare equal.
 */
export function extractFigures(text: string): string[] {
  const figures: string[] = [];
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const normalised = normaliseFigure(match[0]);
    if (normalised !== null) figures.push(normalised);
  }
  return figures;
}

function normaliseFigure(raw: string): string | null {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  // Trailing zeros are insignificant: "14.30" and "14.3" are the same figure.
  return String(value);
}

export interface GroundingSummary {
  claims: number;
  supported: number;
  weak: number;
  unsupported: number;
  uncited: number;
  /** True when no claim failed its evidence check. */
  clean: boolean;
}

export function summariseGrounding(verdicts: ClaimVerdict[]): GroundingSummary {
  const count = (verdict: ClaimVerdict) => verdicts.filter((v) => v === verdict).length;
  const summary = {
    claims: verdicts.length,
    supported: count('supported'),
    weak: count('weak'),
    unsupported: count('unsupported'),
    uncited: count('uncited'),
  };
  return { ...summary, clean: summary.unsupported === 0 && summary.uncited === 0 };
}
