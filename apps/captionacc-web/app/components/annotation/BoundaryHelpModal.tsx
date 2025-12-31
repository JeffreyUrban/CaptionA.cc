interface BoundaryHelpModalProps {
  isOpen: boolean
  onClose: () => void
}

export function BoundaryHelpModal({ isOpen, onClose }: BoundaryHelpModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-opacity-40 p-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg bg-white bg-opacity-75 px-2 py-5 shadow-xl dark:bg-gray-900 dark:bg-opacity-75"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Caption Annotation Guide
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <section>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Purpose</h3>
            <p>
              This page helps you review and correct frame range boundaries for video content. Each
              annotation is either a single caption&apos;s range or a single non-caption range
              between captions.
            </p>
            <p className="mt-2">
              <strong>Important:</strong> The bounds should include both the start and end frames of
              the range, as shown by the colored border around the frames.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Annotation Types
            </h3>
            <div className="space-y-3">
              <div className="rounded-md border-l-2 border-orange-500 bg-orange-50 p-3 dark:bg-orange-900">
                <div className="font-semibold text-orange-600 dark:text-orange-200">
                  Active (Orange Border)
                </div>
                <p className="mt-1 text-orange-200 dark:text-orange-300">
                  The active caption that is presently editable.
                </p>
              </div>

              <div className="rounded-md border-l-2 border-indigo-500 bg-indigo-50 p-3 dark:bg-indigo-950">
                <div className="font-semibold text-indigo-900 dark:text-indigo-200">
                  Predicted (Indigo Border)
                </div>
                <p className="mt-1 text-indigo-800 dark:text-indigo-300">
                  Machine learning predictions for frame range boundaries (captions or non-caption
                  content). These are considered complete and are not included in the review
                  workflow.
                </p>
              </div>

              <div className="rounded-md border-l-2 border-teal-500 bg-teal-50 p-3 dark:bg-teal-950">
                <div className="font-semibold text-teal-900 dark:text-teal-200">
                  Confirmed (Teal Border)
                </div>
                <p className="mt-1 text-teal-800 dark:text-teal-300">
                  Human-verified annotations with correct boundaries for either captions or
                  non-caption content. These are considered complete and accurate.
                </p>
              </div>

              <div className="rounded-md border-l-2 border-pink-500 bg-pink-50 p-3 dark:bg-pink-950">
                <div className="font-semibold text-pink-900 dark:text-pink-200">
                  Pending (Pink Border)
                </div>
                <p className="mt-1 text-pink-800 dark:text-pink-300">
                  Annotations for captions or non-caption content that need review or correction.
                  These appear in the workflow queue for human verification.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Gaps</h3>
            <p>
              Gaps are frame ranges that haven&apos;t been assigned yet. They appear in the workflow
              queue so you can determine what type of content they contain and annotate them
              accordingly.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Workflow</h3>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Review the active annotation or gap shown with a colored border</li>
              <li>Navigate through frames using scroll wheel, drag, or keyboard shortcuts</li>
              <li>Adjust boundaries using Mark Start/End buttons or (left, right) mouse clicks</li>
              <li>
                The orange border shows the range that will be saved as the caption / non-caption
              </li>
              <li>
                Click &ldquo;Save &amp; Next&rdquo; to confirm and move to the next annotation
              </li>
              <li>Use &ldquo;Clear Marks&rdquo; to reset to original boundaries if needed</li>
            </ol>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Rules &amp; Tips
            </h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>Boundaries must include both start and end frames (inclusive)</li>
              <li>A caption can be a single frame (start = end)</li>
              <li>Annotations cannot overlap - each frame belongs to exactly one annotation</li>
              <li>
                A caption can be set to overlap with another caption - that caption will be adjusted
                and set to Pending status
              </li>
              <li>The teal ring highlights the currently displayed frame</li>
              <li>Use frame spacing controls to adjust visible frame density</li>
              <li>Progress tracks the percentage of confirmed and predicted frames</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
