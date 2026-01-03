/**
 * Type definitions for the Boundary Annotation workflow.
 * These types are used across hooks and components for annotating caption boundaries.
 */

export interface Frame {
  frame_index: number
  image_url: string
  ocr_text: string
}

/**
 * Allowed annotation states - single source of truth.
 * Used to generate TypeScript types, SQL CHECK constraints, and validation.
 */
export const ANNOTATION_STATES = ['predicted', 'confirmed', 'gap', 'issue'] as const

export type AnnotationState = (typeof ANNOTATION_STATES)[number]

/**
 * Generate SQL CHECK constraint for annotation states.
 * Used in schema definitions and migrations.
 */
export function getAnnotationStateCheckConstraint(): string {
  const values = ANNOTATION_STATES.map(s => `'${s}'`).join(', ')
  return `CHECK(boundary_state IN (${values}))`
}

export interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  state: AnnotationState
  pending: boolean // When true, annotation is treated as pending for workflow purposes
  text: string | null
  created_at?: string
  updated_at?: string
}

export type FrameSpacing = 'linear' | 'exponential' | 'hybrid'

/**
 * Display state synchronized by RAF loop from internal refs.
 * This is the single source of render state for the boundary workflow.
 */
export interface BoundaryDisplayState {
  currentFrameIndex: number
  frames: Map<number, Frame>
  annotations: Annotation[]
  activeAnnotation: Annotation | null
  markedStart: number | null
  markedEnd: number | null
  hasPrevAnnotation: boolean
  hasNextAnnotation: boolean
  workflowProgress: number
  completedFrames: number
  cursorStyle: 'grab' | 'grabbing'
}

/**
 * Initial display state for the boundary workflow.
 */
export const INITIAL_DISPLAY_STATE: BoundaryDisplayState = {
  currentFrameIndex: 0,
  frames: new Map<number, Frame>(),
  annotations: [],
  activeAnnotation: null,
  markedStart: null,
  markedEnd: null,
  hasPrevAnnotation: false,
  hasNextAnnotation: false,
  workflowProgress: 0,
  completedFrames: 0,
  cursorStyle: 'grab',
}

/**
 * Modulo levels for hierarchical frame loading.
 * Higher modulo = coarser granularity, loaded first for quick overview.
 * Lower modulo = finer granularity, loaded progressively for detail.
 */
export interface ModuloLevel {
  modulo: number
  range: number
}

export const MODULO_LEVELS: ModuloLevel[] = [
  { modulo: 32, range: 1024 },
  { modulo: 16, range: 512 },
  { modulo: 8, range: 256 },
  { modulo: 4, range: 128 },
  { modulo: 2, range: 64 },
  { modulo: 1, range: 32 },
]

/**
 * Chunk of frames to load at a specific modulo level.
 */
export interface QueueChunk {
  modulo: number
  range: number
  frames: number[]
}
