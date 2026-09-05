type AutoCorrectState = {
  isAutoCorrected: true
  displayedQuery: string
  originalQuery: string
}

type DidYouMeanState = {
  isAutoCorrected: false
  suggestion: string
}

export type SearchCorrection =
  | AutoCorrectState
  | DidYouMeanState
  | null

type Props = {
  correction: SearchCorrection
  onApplySuggestion: (suggestion: string) => void
  onSearchOriginal: (original: string) => void
}

export function SearchCorrectionNotice({
  correction,
  onApplySuggestion,
  onSearchOriginal
}: Props): JSX.Element | null {
  if (!correction) return null

  if (correction.isAutoCorrected) {
    return (
      <div className="search-correction" role="status">
        <p className="search-correction-main">
          Showing results for{' '}
          <button
            type="button"
            className="search-correction-strong"
            onClick={() => onApplySuggestion(correction.displayedQuery)}
          >
            {correction.displayedQuery}
          </button>
        </p>
        <p className="search-correction-alt">
          Search instead for{' '}
          <button
            type="button"
            className="search-correction-original"
            onClick={() => onSearchOriginal(correction.originalQuery)}
          >
            {correction.originalQuery}
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="search-correction" role="status">
      <span className="search-correction-main">Did you mean:</span>
      <button
        type="button"
        className="search-correction-chip"
        onClick={() => onApplySuggestion(correction.suggestion)}
      >
        {correction.suggestion}
      </button>
    </div>
  )
}
