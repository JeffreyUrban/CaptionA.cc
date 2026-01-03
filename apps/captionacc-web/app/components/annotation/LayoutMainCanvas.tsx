/**
 * Main canvas component for Layout annotation workflow.
 * Handles rendering of frame/analysis views with overlays.
 */

import {
  RECALC_THRESHOLD,
  type FrameBoxesData,
  type LayoutConfig,
  type BoxData,
  type ViewMode,
} from '~/types/layout'

interface LayoutMainCanvasProps {
  viewMode: ViewMode
  layoutConfig: LayoutConfig | null
  layoutApproved: boolean
  boundsMismatch: boolean
  currentFrameBoxes: FrameBoxesData | null
  analysisBoxes: BoxData[] | null
  loadingFrame: boolean
  annotationsSinceRecalc: number
  selectionPadding: number
  imageRef: React.RefObject<HTMLImageElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  interactionAreaRef: React.RefObject<HTMLDivElement | null>
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
}

/**
 * Overlay shown during crop bounds recalculation
 */
function RecalculatingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-blue-900 bg-opacity-70 pointer-events-none">
      <div className="bg-blue-800 px-6 py-4 rounded-lg shadow-lg">
        <div className="text-white text-lg font-semibold mb-2">Recalculating Crop Bounds</div>
        <div className="text-blue-200 text-sm">Annotations temporarily disabled...</div>
        <div className="mt-3 h-1 w-64 rounded-full bg-blue-700">
          <div className="h-1 rounded-full bg-blue-300 animate-pulse" style={{ width: '100%' }} />
        </div>
      </div>
    </div>
  )
}

/**
 * Analysis view canvas content
 */
function AnalysisViewContent({
  layoutConfig,
  layoutApproved,
  boundsMismatch,
  analysisBoxes,
  annotationsSinceRecalc,
  selectionPadding,
  imageRef,
  canvasRef,
  interactionAreaRef,
  onMouseDown,
  onMouseMove,
  onContextMenu,
}: Omit<LayoutMainCanvasProps, 'viewMode' | 'currentFrameBoxes' | 'loadingFrame'> & {
  layoutConfig: LayoutConfig
}) {
  return (
    <div
      ref={interactionAreaRef}
      className="relative inline-block cursor-crosshair"
      style={{ padding: `${selectionPadding}px` }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onContextMenu={onContextMenu}
    >
      <div
        className="relative"
        style={{
          outline: boundsMismatch
            ? '3px solid #ec4899' // pink-500
            : layoutApproved
              ? '3px solid #10b981' // green-500
              : 'none',
        }}
      >
        <img
          ref={imageRef}
          src={`data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="${layoutConfig.frameWidth}" height="${layoutConfig.frameHeight}"><rect width="100%" height="100%" fill="black"/></svg>`}
          alt="Analysis view"
          className="max-w-full max-h-full object-contain block"
        />
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0"
          style={{ touchAction: 'none', pointerEvents: 'none' }}
        />
      </div>
      {analysisBoxes === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="text-white text-lg">Loading analysis boxes...</div>
        </div>
      )}
      {annotationsSinceRecalc >= RECALC_THRESHOLD && <RecalculatingOverlay />}
    </div>
  )
}

/**
 * Frame view canvas content
 */
function FrameViewContent({
  currentFrameBoxes,
  annotationsSinceRecalc,
  selectionPadding,
  imageRef,
  canvasRef,
  interactionAreaRef,
  onMouseDown,
  onMouseMove,
  onContextMenu,
}: Pick<
  LayoutMainCanvasProps,
  | 'annotationsSinceRecalc'
  | 'selectionPadding'
  | 'imageRef'
  | 'canvasRef'
  | 'interactionAreaRef'
  | 'onMouseDown'
  | 'onMouseMove'
  | 'onContextMenu'
> & {
  currentFrameBoxes: FrameBoxesData
}) {
  const allBoxesAnnotated = currentFrameBoxes.boxes.every(box => box.userLabel !== null)

  return (
    <div
      ref={interactionAreaRef}
      className="relative inline-block cursor-crosshair"
      style={{ padding: `${selectionPadding}px` }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onContextMenu={onContextMenu}
    >
      <div
        className="relative"
        style={{
          outline: allBoxesAnnotated ? '3px solid #10b981' : 'none',
        }}
      >
        <img
          ref={imageRef}
          src={currentFrameBoxes.imageUrl}
          alt={`Frame ${currentFrameBoxes.frameIndex}`}
          className="max-w-full max-h-full object-contain block"
        />
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0"
          style={{ touchAction: 'none', pointerEvents: 'none' }}
        />
      </div>
      {annotationsSinceRecalc >= RECALC_THRESHOLD && <RecalculatingOverlay />}
    </div>
  )
}

/**
 * Empty state when no frame is selected
 */
function EmptyState({ loadingFrame }: { loadingFrame: boolean }) {
  return (
    <div className="flex min-h-[400px] items-center justify-center text-gray-500 dark:text-gray-400">
      {loadingFrame ? 'Loading frame...' : 'Select a frame to annotate'}
    </div>
  )
}

export function LayoutMainCanvas({
  viewMode,
  layoutConfig,
  layoutApproved,
  boundsMismatch,
  currentFrameBoxes,
  analysisBoxes,
  loadingFrame,
  annotationsSinceRecalc,
  selectionPadding,
  imageRef,
  canvasRef,
  interactionAreaRef,
  onMouseDown,
  onMouseMove,
  onContextMenu,
}: LayoutMainCanvasProps) {
  return (
    <div className="relative flex flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-gray-900 dark:border-gray-600 dark:bg-gray-800">
      {viewMode === 'analysis' && layoutConfig ? (
        <AnalysisViewContent
          layoutConfig={layoutConfig}
          layoutApproved={layoutApproved}
          boundsMismatch={boundsMismatch}
          analysisBoxes={analysisBoxes}
          annotationsSinceRecalc={annotationsSinceRecalc}
          selectionPadding={selectionPadding}
          imageRef={imageRef}
          canvasRef={canvasRef}
          interactionAreaRef={interactionAreaRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onContextMenu={onContextMenu}
        />
      ) : viewMode === 'frame' && currentFrameBoxes ? (
        <FrameViewContent
          currentFrameBoxes={currentFrameBoxes}
          annotationsSinceRecalc={annotationsSinceRecalc}
          selectionPadding={selectionPadding}
          imageRef={imageRef}
          canvasRef={canvasRef}
          interactionAreaRef={interactionAreaRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onContextMenu={onContextMenu}
        />
      ) : (
        <EmptyState loadingFrame={loadingFrame} />
      )}
    </div>
  )
}
