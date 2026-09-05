import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Night Mode: dynamics compressor + optional gain boost.
 * Once MediaElementSource is created for a <video>, audio must stay on the Web Audio
 * graph — when disabled we passthrough source → destination (no compressor/boost).
 */
export function useAudioEnhancer(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  gainValue = 1
): void {
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const wiredVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // New video element → drop previous graph
    if (wiredVideoRef.current && wiredVideoRef.current !== video) {
      try {
        sourceRef.current?.disconnect()
      } catch {
        /* ignore */
      }
      sourceRef.current = null
      compressorRef.current = null
      gainRef.current = null
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        void ctxRef.current.close()
      }
      ctxRef.current = null
      wiredVideoRef.current = null
    }

    // Never touch Web Audio until Night Mode is turned on at least once for this video.
    if (!enabled && !sourceRef.current) return

    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return

    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AC()
    }
    const ctx = ctxRef.current

    if (ctx.state === 'suspended') {
      void ctx.resume()
    }

    if (!sourceRef.current) {
      try {
        sourceRef.current = ctx.createMediaElementSource(video)
        wiredVideoRef.current = video
      } catch (err) {
        console.warn('[audio-enhancer] createMediaElementSource failed', err)
        return
      }
    }

    const disconnectAll = (): void => {
      try {
        sourceRef.current?.disconnect()
      } catch {
        /* ignore */
      }
      try {
        compressorRef.current?.disconnect()
      } catch {
        /* ignore */
      }
      try {
        gainRef.current?.disconnect()
      } catch {
        /* ignore */
      }
    }

    disconnectAll()

    if (!enabled) {
      sourceRef.current.connect(ctx.destination)
      return
    }

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.setValueAtTime(-24, ctx.currentTime)
    compressor.knee.setValueAtTime(30, ctx.currentTime)
    compressor.ratio.setValueAtTime(12, ctx.currentTime)
    compressor.attack.setValueAtTime(0.003, ctx.currentTime)
    compressor.release.setValueAtTime(0.25, ctx.currentTime)

    const gainNode = ctx.createGain()
    const boost = Math.min(2, Math.max(1, gainValue || 1))
    gainNode.gain.setValueAtTime(boost, ctx.currentTime)

    sourceRef.current.connect(compressor)
    compressor.connect(gainNode)
    gainNode.connect(ctx.destination)

    compressorRef.current = compressor
    gainRef.current = gainNode

    return () => {
      // Keep graph alive across dependency churn; teardown on unmount handled below.
      if (gainRef.current && enabled) {
        gainRef.current.gain.setValueAtTime(boost, ctx.currentTime)
      }
    }
  }, [enabled, gainValue, videoRef])

  useEffect(() => {
    return () => {
      try {
        sourceRef.current?.disconnect()
      } catch {
        /* ignore */
      }
      sourceRef.current = null
      compressorRef.current = null
      gainRef.current = null
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        void ctxRef.current.close()
      }
      ctxRef.current = null
      wiredVideoRef.current = null
    }
  }, [])
}
