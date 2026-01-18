/**
 * Main canvas component for Layout annotation workflow.
 * Handles rendering of frame/analysis views with overlays.
 */

import { S3Image } from '~/components/S3Image'
import { type FrameBoxesData, type LayoutConfig, type BoxData, type ViewMode } from '~/types/layout'

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
  tenantId: string
  videoId: string
}

/**
 * Analysis view canvas content
 */
function AnalysisViewContent({
  layoutConfig,
  layoutApproved,
  boundsMismatch,
  analysisBoxes,
  annotationsSinceRecalc: _annotationsSinceRecalc,
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
      {/* RecalculatingOverlay removed - processing now happens in background without blocking */}
    </div>
  )
}

/**
 * Frame view canvas content
 */
function FrameViewContent({
  currentFrameBoxes,
  annotationsSinceRecalc: _annotationsSinceRecalc,
  selectionPadding,
  imageRef,
  canvasRef,
  interactionAreaRef,
  onMouseDown,
  onMouseMove,
  onContextMenu,
  tenantId,
  videoId,
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
  | 'tenantId'
  | 'videoId'
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
        {/* Placeholder to maintain dimensions while loading */}
        <img
          src={`data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="${currentFrameBoxes.frameWidth}" height="${currentFrameBoxes.frameHeight}"><rect width="100%" height="100%" fill="black"/></svg>`}
          alt="Frame placeholder"
          className="max-w-full max-h-full object-contain block"
        />
        {/* Actual frame image rendered on top */}
        <S3Image
          ref={imageRef}
          tenantId={tenantId}
          videoId={videoId}
          path={currentFrameBoxes.imageUrl}
          alt={`Frame ${currentFrameBoxes.frameIndex}`}
          className="absolute left-0 top-0 max-w-full max-h-full object-contain block"
        />
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0"
          style={{ touchAction: 'none', pointerEvents: 'none' }}
        />
      </div>
      {/* RecalculatingOverlay removed - processing now happens in background without blocking */}
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
  tenantId,
  videoId,
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
          tenantId={tenantId}
          videoId={videoId}
        />
      ) : (
        <EmptyState loadingFrame={loadingFrame} />
      )}
    </div>
  )
}
