/**
 * TypeScript types for Supabase database schema
 * Generated from the initial_schema.sql migration
 *
 * To regenerate these types:
 * npx supabase gen types typescript --local > app/types/supabase.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          name: string
          slug: string
          storage_quota_gb: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          storage_quota_gb?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          storage_quota_gb?: number | null
          created_at?: string | null
        }
      }
      user_profiles: {
        Row: {
          id: string
          tenant_id: string | null
          full_name: string | null
          avatar_url: string | null
          role: 'user' | 'admin' | 'annotator' | null
          created_at: string | null
        }
        Insert: {
          id: string
          tenant_id?: string | null
          full_name?: string | null
          avatar_url?: string | null
          role?: 'user' | 'admin' | 'annotator' | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string | null
          full_name?: string | null
          avatar_url?: string | null
          role?: 'user' | 'admin' | 'annotator' | null
          created_at?: string | null
        }
      }
      videos: {
        Row: {
          id: string
          tenant_id: string | null
          filename: string
          size_bytes: number | null
          duration_seconds: number | null
          storage_key: string
          annotations_db_key: string | null
          status:
            | 'uploading'
            | 'processing'
            | 'active'
            | 'failed'
            | 'archived'
            | 'soft_deleted'
            | 'purged'
            | null
          locked_by_user_id: string | null
          locked_at: string | null
          uploaded_by_user_id: string | null
          uploaded_at: string | null
          prefect_flow_run_id: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          tenant_id?: string | null
          filename: string
          size_bytes?: number | null
          duration_seconds?: number | null
          storage_key: string
          annotations_db_key?: string | null
          status?:
            | 'uploading'
            | 'processing'
            | 'active'
            | 'failed'
            | 'archived'
            | 'soft_deleted'
            | 'purged'
            | null
          locked_by_user_id?: string | null
          locked_at?: string | null
          uploaded_by_user_id?: string | null
          uploaded_at?: string | null
          prefect_flow_run_id?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string | null
          filename?: string
          size_bytes?: number | null
          duration_seconds?: number | null
          storage_key?: string
          annotations_db_key?: string | null
          status?:
            | 'uploading'
            | 'processing'
            | 'active'
            | 'failed'
            | 'archived'
            | 'soft_deleted'
            | 'purged'
            | null
          locked_by_user_id?: string | null
          locked_at?: string | null
          uploaded_by_user_id?: string | null
          uploaded_at?: string | null
          prefect_flow_run_id?: string | null
          deleted_at?: string | null
        }
      }
      training_cohorts: {
        Row: {
          id: string
          language: string | null
          domain: string | null
          snapshot_storage_key: string | null
          created_at: string | null
          wandb_run_id: string | null
          git_commit: string | null
          total_videos: number | null
          total_frames: number | null
          total_annotations: number | null
          status: 'building' | 'training' | 'completed' | 'deprecated' | null
          immutable: boolean | null
        }
        Insert: {
          id: string
          language?: string | null
          domain?: string | null
          snapshot_storage_key?: string | null
          created_at?: string | null
          wandb_run_id?: string | null
          git_commit?: string | null
          total_videos?: number | null
          total_frames?: number | null
          total_annotations?: number | null
          status?: 'building' | 'training' | 'completed' | 'deprecated' | null
          immutable?: boolean | null
        }
        Update: {
          id?: string
          language?: string | null
          domain?: string | null
          snapshot_storage_key?: string | null
          created_at?: string | null
          wandb_run_id?: string | null
          git_commit?: string | null
          total_videos?: number | null
          total_frames?: number | null
          total_annotations?: number | null
          status?: 'building' | 'training' | 'completed' | 'deprecated' | null
          immutable?: boolean | null
        }
      }
      cohort_videos: {
        Row: {
          cohort_id: string
          video_id: string
          tenant_id: string | null
          frames_contributed: number | null
          annotations_contributed: number | null
          included_at: string | null
        }
        Insert: {
          cohort_id: string
          video_id: string
          tenant_id?: string | null
          frames_contributed?: number | null
          annotations_contributed?: number | null
          included_at?: string | null
        }
        Update: {
          cohort_id?: string
          video_id?: string
          tenant_id?: string | null
          frames_contributed?: number | null
          annotations_contributed?: number | null
          included_at?: string | null
        }
      }
      video_search_index: {
        Row: {
          id: number
          video_id: string | null
          frame_index: number | null
          ocr_text: string | null
          caption_text: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          video_id?: string | null
          frame_index?: number | null
          ocr_text?: string | null
          caption_text?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          video_id?: string | null
          frame_index?: number | null
          ocr_text?: string | null
          caption_text?: string | null
          updated_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
