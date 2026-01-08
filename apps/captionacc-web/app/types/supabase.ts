export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.1'
  }
  captionacc_production: {
    Tables: {
      boundary_inference_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          cropped_frames_version: number
          error_message: string | null
          id: string
          inference_run_id: string | null
          model_version: string
          priority: string
          started_at: string | null
          status: string
          tenant_id: string
          video_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          cropped_frames_version: number
          error_message?: string | null
          id?: string
          inference_run_id?: string | null
          model_version: string
          priority: string
          started_at?: string | null
          status: string
          tenant_id: string
          video_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          cropped_frames_version?: number
          error_message?: string | null
          id?: string
          inference_run_id?: string | null
          model_version?: string
          priority?: string
          started_at?: string | null
          status?: string
          tenant_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'boundary_inference_jobs_inference_run_id_fkey'
            columns: ['inference_run_id']
            isOneToOne: false
            referencedRelation: 'boundary_inference_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'boundary_inference_jobs_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
        ]
      }
      boundary_inference_rejections: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string | null
          cropped_frames_version: number | null
          estimated_cost_usd: number | null
          frame_count: number | null
          id: string
          model_version: string | null
          priority: string | null
          rejection_message: string
          rejection_type: string
          tenant_id: string
          video_id: string
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string | null
          cropped_frames_version?: number | null
          estimated_cost_usd?: number | null
          frame_count?: number | null
          id?: string
          model_version?: string | null
          priority?: string | null
          rejection_message: string
          rejection_type: string
          tenant_id: string
          video_id: string
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string | null
          cropped_frames_version?: number | null
          estimated_cost_usd?: number | null
          frame_count?: number | null
          id?: string
          model_version?: string | null
          priority?: string | null
          rejection_message?: string
          rejection_type?: string
          tenant_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'boundary_inference_rejections_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
        ]
      }
      boundary_inference_runs: {
        Row: {
          completed_at: string
          created_at: string | null
          cropped_frames_version: number
          file_size_bytes: number | null
          id: string
          model_checkpoint_path: string | null
          model_version: string
          processing_time_seconds: number | null
          run_id: string
          started_at: string
          tenant_id: string
          total_pairs: number
          video_id: string
          wasabi_storage_key: string
        }
        Insert: {
          completed_at: string
          created_at?: string | null
          cropped_frames_version: number
          file_size_bytes?: number | null
          id?: string
          model_checkpoint_path?: string | null
          model_version: string
          processing_time_seconds?: number | null
          run_id: string
          started_at: string
          tenant_id: string
          total_pairs: number
          video_id: string
          wasabi_storage_key: string
        }
        Update: {
          completed_at?: string
          created_at?: string | null
          cropped_frames_version?: number
          file_size_bytes?: number | null
          id?: string
          model_checkpoint_path?: string | null
          model_version?: string
          processing_time_seconds?: number | null
          run_id?: string
          started_at?: string
          tenant_id?: string
          total_pairs?: number
          video_id?: string
          wasabi_storage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: 'boundary_inference_runs_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
        ]
      }
      cohort_videos: {
        Row: {
          annotations_contributed: number | null
          cohort_id: string
          frames_contributed: number | null
          included_at: string | null
          tenant_id: string | null
          video_id: string
        }
        Insert: {
          annotations_contributed?: number | null
          cohort_id: string
          frames_contributed?: number | null
          included_at?: string | null
          tenant_id?: string | null
          video_id: string
        }
        Update: {
          annotations_contributed?: number | null
          cohort_id?: string
          frames_contributed?: number | null
          included_at?: string | null
          tenant_id?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cohort_videos_cohort_id_fkey'
            columns: ['cohort_id']
            isOneToOne: false
            referencedRelation: 'training_cohorts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cohort_videos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cohort_videos_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
        ]
      }
      cropped_frames_versions: {
        Row: {
          activated_at: string | null
          archived_at: string | null
          chunk_count: number | null
          created_at: string | null
          created_by_user_id: string | null
          crop_bounds: Json | null
          frame_rate: number | null
          id: string
          layout_db_hash: string | null
          layout_db_storage_key: string | null
          prefect_flow_run_id: string | null
          status: string | null
          storage_prefix: string
          tenant_id: string
          total_frames: number | null
          total_size_bytes: number | null
          version: number
          video_id: string
        }
        Insert: {
          activated_at?: string | null
          archived_at?: string | null
          chunk_count?: number | null
          created_at?: string | null
          created_by_user_id?: string | null
          crop_bounds?: Json | null
          frame_rate?: number | null
          id?: string
          layout_db_hash?: string | null
          layout_db_storage_key?: string | null
          prefect_flow_run_id?: string | null
          status?: string | null
          storage_prefix: string
          tenant_id: string
          total_frames?: number | null
          total_size_bytes?: number | null
          version: number
          video_id: string
        }
        Update: {
          activated_at?: string | null
          archived_at?: string | null
          chunk_count?: number | null
          created_at?: string | null
          created_by_user_id?: string | null
          crop_bounds?: Json | null
          frame_rate?: number | null
          id?: string
          layout_db_hash?: string | null
          layout_db_storage_key?: string | null
          prefect_flow_run_id?: string | null
          status?: string | null
          storage_prefix?: string
          tenant_id?: string
          total_frames?: number | null
          total_size_bytes?: number | null
          version?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cropped_frames_versions_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'cropped_frames_versions_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          max_uses: number | null
          notes: string | null
          used_at: string | null
          used_by: string | null
          uses_count: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          max_uses?: number | null
          notes?: string | null
          used_at?: string | null
          used_by?: string | null
          uses_count?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          max_uses?: number | null
          notes?: string | null
          used_at?: string | null
          used_by?: string | null
          uses_count?: number | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          admin_level: string
          granted_at: string | null
          granted_by: string | null
          notes: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          admin_level: string
          granted_at?: string | null
          granted_by?: string | null
          notes?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          admin_level?: string
          granted_at?: string | null
          granted_by?: string | null
          notes?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
          storage_quota_gb: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
          storage_quota_gb?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
          storage_quota_gb?: number | null
        }
        Relationships: []
      }
      training_cohorts: {
        Row: {
          created_at: string | null
          domain: string | null
          git_commit: string | null
          id: string
          immutable: boolean | null
          language: string | null
          snapshot_storage_key: string | null
          status: string | null
          total_annotations: number | null
          total_frames: number | null
          total_videos: number | null
          wandb_run_id: string | null
        }
        Insert: {
          created_at?: string | null
          domain?: string | null
          git_commit?: string | null
          id: string
          immutable?: boolean | null
          language?: string | null
          snapshot_storage_key?: string | null
          status?: string | null
          total_annotations?: number | null
          total_frames?: number | null
          total_videos?: number | null
          wandb_run_id?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string | null
          git_commit?: string | null
          id?: string
          immutable?: boolean | null
          language?: string | null
          snapshot_storage_key?: string | null
          status?: string | null
          total_annotations?: number | null
          total_frames?: number | null
          total_videos?: number | null
          wandb_run_id?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          role: string | null
          tenant_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          role?: string | null
          tenant_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'user_profiles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      video_search_index: {
        Row: {
          caption_text: string | null
          frame_index: number | null
          id: number
          ocr_text: string | null
          search_vector: unknown
          updated_at: string | null
          video_id: string | null
        }
        Insert: {
          caption_text?: string | null
          frame_index?: number | null
          id?: number
          ocr_text?: string | null
          search_vector?: unknown
          updated_at?: string | null
          video_id?: string | null
        }
        Update: {
          caption_text?: string | null
          frame_index?: number | null
          id?: number
          ocr_text?: string | null
          search_vector?: unknown
          updated_at?: string | null
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'video_search_index_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
        ]
      }
      videos: {
        Row: {
          annotations_db_key: string | null
          current_cropped_frames_version: number | null
          deleted_at: string | null
          duration_seconds: number | null
          id: string
          locked_at: string | null
          locked_by_user_id: string | null
          prefect_flow_run_id: string | null
          size_bytes: number | null
          status: string | null
          storage_key: string
          tenant_id: string | null
          uploaded_at: string | null
          uploaded_by_user_id: string | null
          video_path: string
        }
        Insert: {
          annotations_db_key?: string | null
          current_cropped_frames_version?: number | null
          deleted_at?: string | null
          duration_seconds?: number | null
          id?: string
          locked_at?: string | null
          locked_by_user_id?: string | null
          prefect_flow_run_id?: string | null
          size_bytes?: number | null
          status?: string | null
          storage_key: string
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by_user_id?: string | null
          video_path: string
        }
        Update: {
          annotations_db_key?: string | null
          current_cropped_frames_version?: number | null
          deleted_at?: string | null
          duration_seconds?: number | null
          id?: string
          locked_at?: string | null
          locked_by_user_id?: string | null
          prefect_flow_run_id?: string | null
          size_bytes?: number | null
          status?: string | null
          storage_key?: string
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by_user_id?: string | null
          video_path?: string
        }
        Relationships: [
          {
            foreignKeyName: 'videos_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_cropped_frames_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      current_user_tenant_id: { Args: never; Returns: string }
      get_next_cropped_frames_version: {
        Args: { p_video_id: string }
        Returns: number
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_tenant_owner: { Args: { tenant_uuid: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  captionacc_staging: {
    Tables: {
      cohort_videos: {
        Row: {
          annotations_contributed: number | null
          cohort_id: string
          frames_contributed: number | null
          included_at: string | null
          tenant_id: string | null
          video_id: string
        }
        Insert: {
          annotations_contributed?: number | null
          cohort_id: string
          frames_contributed?: number | null
          included_at?: string | null
          tenant_id?: string | null
          video_id: string
        }
        Update: {
          annotations_contributed?: number | null
          cohort_id?: string
          frames_contributed?: number | null
          included_at?: string | null
          tenant_id?: string | null
          video_id?: string
        }
        Relationships: []
      }
      cropped_frames_versions: {
        Row: {
          activated_at: string | null
          archived_at: string | null
          chunk_count: number | null
          created_at: string | null
          created_by_user_id: string | null
          crop_bounds: Json | null
          frame_rate: number | null
          id: string
          layout_db_hash: string | null
          layout_db_storage_key: string | null
          prefect_flow_run_id: string | null
          status: string | null
          storage_prefix: string
          tenant_id: string
          total_frames: number | null
          total_size_bytes: number | null
          version: number
          video_id: string
        }
        Insert: {
          activated_at?: string | null
          archived_at?: string | null
          chunk_count?: number | null
          created_at?: string | null
          created_by_user_id?: string | null
          crop_bounds?: Json | null
          frame_rate?: number | null
          id?: string
          layout_db_hash?: string | null
          layout_db_storage_key?: string | null
          prefect_flow_run_id?: string | null
          status?: string | null
          storage_prefix: string
          tenant_id: string
          total_frames?: number | null
          total_size_bytes?: number | null
          version: number
          video_id: string
        }
        Update: {
          activated_at?: string | null
          archived_at?: string | null
          chunk_count?: number | null
          created_at?: string | null
          created_by_user_id?: string | null
          crop_bounds?: Json | null
          frame_rate?: number | null
          id?: string
          layout_db_hash?: string | null
          layout_db_storage_key?: string | null
          prefect_flow_run_id?: string | null
          status?: string | null
          storage_prefix?: string
          tenant_id?: string
          total_frames?: number | null
          total_size_bytes?: number | null
          version?: number
          video_id?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
          storage_quota_gb: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
          storage_quota_gb?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
          storage_quota_gb?: number | null
        }
        Relationships: []
      }
      training_cohorts: {
        Row: {
          created_at: string | null
          domain: string | null
          git_commit: string | null
          id: string
          immutable: boolean | null
          language: string | null
          snapshot_storage_key: string | null
          status: string | null
          total_annotations: number | null
          total_frames: number | null
          total_videos: number | null
          wandb_run_id: string | null
        }
        Insert: {
          created_at?: string | null
          domain?: string | null
          git_commit?: string | null
          id: string
          immutable?: boolean | null
          language?: string | null
          snapshot_storage_key?: string | null
          status?: string | null
          total_annotations?: number | null
          total_frames?: number | null
          total_videos?: number | null
          wandb_run_id?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string | null
          git_commit?: string | null
          id?: string
          immutable?: boolean | null
          language?: string | null
          snapshot_storage_key?: string | null
          status?: string | null
          total_annotations?: number | null
          total_frames?: number | null
          total_videos?: number | null
          wandb_run_id?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          role: string | null
          tenant_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          role?: string | null
          tenant_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      video_search_index: {
        Row: {
          caption_text: string | null
          frame_index: number | null
          id: number
          ocr_text: string | null
          search_vector: unknown
          updated_at: string | null
          video_id: string | null
        }
        Insert: {
          caption_text?: string | null
          frame_index?: number | null
          id?: number
          ocr_text?: string | null
          search_vector?: unknown
          updated_at?: string | null
          video_id?: string | null
        }
        Update: {
          caption_text?: string | null
          frame_index?: number | null
          id?: number
          ocr_text?: string | null
          search_vector?: unknown
          updated_at?: string | null
          video_id?: string | null
        }
        Relationships: []
      }
      videos: {
        Row: {
          annotations_db_key: string | null
          current_cropped_frames_version: number | null
          deleted_at: string | null
          duration_seconds: number | null
          filename: string
          id: string
          locked_at: string | null
          locked_by_user_id: string | null
          prefect_flow_run_id: string | null
          size_bytes: number | null
          status: string | null
          storage_key: string
          tenant_id: string | null
          uploaded_at: string | null
          uploaded_by_user_id: string | null
        }
        Insert: {
          annotations_db_key?: string | null
          current_cropped_frames_version?: number | null
          deleted_at?: string | null
          duration_seconds?: number | null
          filename: string
          id?: string
          locked_at?: string | null
          locked_by_user_id?: string | null
          prefect_flow_run_id?: string | null
          size_bytes?: number | null
          status?: string | null
          storage_key: string
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by_user_id?: string | null
        }
        Update: {
          annotations_db_key?: string | null
          current_cropped_frames_version?: number | null
          deleted_at?: string | null
          duration_seconds?: number | null
          filename?: string
          id?: string
          locked_at?: string | null
          locked_by_user_id?: string | null
          prefect_flow_run_id?: string | null
          size_bytes?: number | null
          status?: string | null
          storage_key?: string
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by_user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_cropped_frames_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      get_next_cropped_frames_version: {
        Args: { p_video_id: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      copy_schema_structure: {
        Args: {
          include_data?: boolean
          source_schema: string
          target_schema: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database['storage']['Enums']['buckettype']
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database['storage']['Enums']['buckettype']
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database['storage']['Enums']['buckettype']
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database['storage']['Enums']['buckettype']
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database['storage']['Enums']['buckettype']
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database['storage']['Enums']['buckettype']
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database['storage']['Enums']['buckettype']
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database['storage']['Enums']['buckettype']
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database['storage']['Enums']['buckettype']
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          level: number | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'objects_bucketId_fkey'
            columns: ['bucket_id']
            isOneToOne: false
            referencedRelation: 'buckets'
            referencedColumns: ['id']
          },
        ]
      }
      prefixes: {
        Row: {
          bucket_id: string
          created_at: string | null
          level: number
          name: string
          updated_at: string | null
        }
        Insert: {
          bucket_id: string
          created_at?: string | null
          level?: number
          name: string
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string
          created_at?: string | null
          level?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'prefixes_bucketId_fkey'
            columns: ['bucket_id']
            isOneToOne: false
            referencedRelation: 'buckets'
            referencedColumns: ['id']
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: 's3_multipart_uploads_bucket_id_fkey'
            columns: ['bucket_id']
            isOneToOne: false
            referencedRelation: 'buckets'
            referencedColumns: ['id']
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: 's3_multipart_uploads_parts_bucket_id_fkey'
            columns: ['bucket_id']
            isOneToOne: false
            referencedRelation: 'buckets'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 's3_multipart_uploads_parts_upload_id_fkey'
            columns: ['upload_id']
            isOneToOne: false
            referencedRelation: 's3_multipart_uploads'
            referencedColumns: ['id']
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vector_indexes_bucket_id_fkey'
            columns: ['bucket_id']
            isOneToOne: false
            referencedRelation: 'buckets_vectors'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_prefixes: {
        Args: { _bucket_id: string; _name: string }
        Returns: undefined
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      delete_leaf_prefixes: {
        Args: { bucket_ids: string[]; names: string[] }
        Returns: undefined
      }
      delete_prefix: {
        Args: { _bucket_id: string; _name: string }
        Returns: boolean
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_level: { Args: { name: string }; Returns: number }
      get_prefix: { Args: { name: string }; Returns: string }
      get_prefixes: { Args: { name: string }; Returns: string[] }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          start_after?: string
        }
        Returns: {
          id: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      lock_top_prefixes: {
        Args: { bucket_ids: string[]; names: string[] }
        Returns: undefined
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_legacy_v1: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v1_optimised: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: 'STANDARD' | 'ANALYTICS' | 'VECTOR'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  captionacc_production: {
    Enums: {},
  },
  captionacc_staging: {
    Enums: {},
  },
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ['STANDARD', 'ANALYTICS', 'VECTOR'],
    },
  },
} as const
