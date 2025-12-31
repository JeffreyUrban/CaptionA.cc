interface TextAnnotationHelpModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Help modal for the Text Annotation workflow.
 * Displays usage instructions and status option explanations.
 */
export function TextAnnotationHelpModal({ isOpen, onClose }: TextAnnotationHelpModalProps) {
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
            Text Annotation Guide
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            X
          </button>
        </div>

        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <PurposeSection />
          <WorkflowSection />
          <StatusOptionsSection />
          <TipsSection />
        </div>
      </div>
    </div>
  )
}

function PurposeSection() {
  return (
    <section>
      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Purpose</h3>
      <p>
        This page helps you review and correct text extracted from video captions. Each annotation
        shows a combined image of all frames in the caption along with OCR-extracted text that you
        can correct.
      </p>
    </section>
  )
}

function WorkflowSection() {
  return (
    <section>
      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Workflow</h3>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Review the combined image showing all caption frames</li>
        <li>Check the OCR-extracted text for accuracy</li>
        <li>Edit the caption text to correct any OCR errors</li>
        <li>Select the appropriate status for the annotation</li>
        <li>Add notes if needed (optional)</li>
        <li>Click &quot;Save &amp; Next&quot; to save and move to the next annotation</li>
      </ol>
    </section>
  )
}

function StatusOptionsSection() {
  return (
    <section>
      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Status Options</h3>
      <div className="space-y-2">
        <div>
          <strong className="text-gray-900 dark:text-white">Valid Caption:</strong> Caption text is
          correct and complete
        </div>
        <div>
          <strong className="text-gray-900 dark:text-white">OCR Error:</strong> OCR extracted
          incorrect text that was corrected
        </div>
        <div>
          <strong className="text-gray-900 dark:text-white">Partial Caption:</strong> Only part of
          the caption is visible or readable
        </div>
        <div>
          <strong className="text-gray-900 dark:text-white">Text Unclear:</strong> Text is difficult
          to read in the image
        </div>
        <div>
          <strong className="text-gray-900 dark:text-white">Other Issue:</strong> Other problems
          with the annotation (explain in notes)
        </div>
      </div>
    </section>
  )
}

function TipsSection() {
  return (
    <section>
      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Tips</h3>
      <ul className="list-disc space-y-2 pl-5">
        <li>Use the combined image to verify OCR accuracy</li>
        <li>Empty text field means &quot;no caption&quot; (valid for gaps)</li>
        <li>Use notes to explain unusual cases or issues</li>
        <li>Use keyboard shortcuts for faster navigation</li>
        <li>Progress tracks completed vs total annotations</li>
      </ul>
    </section>
  )
}
