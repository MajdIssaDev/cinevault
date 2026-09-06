/**
 * Featured hero hydration — optimal scenic TMDB backdrops + title logos.
 * Primary implementation lives in `lib/featuredDeck.ts` / `lib/heroBackdrop.ts`.
 */
export {
  FEATURED_DECK_MAX,
  FEATURED_SLIDE_MS,
  buildFeaturedDeck,
  pickFeaturedCandidates,
  type FeaturedSlide
} from '../lib/featuredDeck'

export {
  selectOptimalHeroBackdrop,
  type TMDBBackdrop
} from '../lib/heroBackdrop'
