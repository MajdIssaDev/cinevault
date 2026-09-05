import { useEffect, useState, type MouseEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

type GalleryLightboxProps = {
  images: string[]
  initialIndex: number
  onClose: () => void
}

export function GalleryLightbox({
  images,
  initialIndex,
  onClose
}: GalleryLightboxProps): JSX.Element | null {
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1)))
  )

  useEffect(() => {
    setCurrentIndex(Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1))))
  }, [initialIndex, images.length])

  const handlePrev = (e?: MouseEvent): void => {
    e?.stopPropagation()
    if (images.length < 2) return
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1))
  }

  const handleNext = (e?: MouseEvent): void => {
    e?.stopPropagation()
    if (images.length < 2) return
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1))
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nav closes over latest images.length via setState
  }, [images.length, onClose])

  if (!images.length) return null

  const src = images[currentIndex] || images[0]

  return (
    <div
      className="gallery-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Gallery image ${currentIndex + 1} of ${images.length}`}
      onClick={onClose}
    >
      <button type="button" className="gallery-close" onClick={onClose} aria-label="Close gallery">
        <X size={18} strokeWidth={2.25} />
        <span>Close</span>
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            className="gallery-nav gallery-nav-prev"
            aria-label="Previous image"
            onClick={handlePrev}
          >
            <ChevronLeft size={26} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className="gallery-nav gallery-nav-next"
            aria-label="Next image"
            onClick={handleNext}
          >
            <ChevronRight size={26} strokeWidth={2.5} />
          </button>
        </>
      )}

      <div className="gallery-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.img
            key={src}
            src={src}
            alt={`Still ${currentIndex + 1}`}
            className="gallery-lightbox-img"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            draggable={false}
          />
        </AnimatePresence>
      </div>

      {images.length > 1 && (
        <div className="gallery-counter" aria-live="polite">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  )
}
