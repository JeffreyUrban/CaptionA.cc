export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  captionacc_production: {
    Tables: {
      access_tiers: {
        Row: {
          created_at: string | null
          description: string | null
          features: Json
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          features: Json
          id: string
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          features?: Json
          id?: string
          name?: string
        }
        Relationships: []
      }
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
            foreignKeyName: "boundary_inference_jobs_inference_run_id_fkey"
            columns: ["inference_run_id"]
            isOneToOne: false
            referencedRelation: "boundary_inference_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boundary_inference_jobs_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
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
            foreignKeyName: "boundary_inference_rejections_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
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
            foreignKeyName: "boundary_inference_runs_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
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
            foreignKeyName: "cohort_videos_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "training_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_videos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_videos_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
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
            foreignKeyName: "cropped_frames_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cropped_frames_versions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_uploads: {
        Row: {
          tenant_id: string
          total_bytes: number | null
          upload_count: number | null
          upload_date: string
        }
        Insert: {
          tenant_id: string
          total_bytes?: number | null
          upload_count?: number | null
          upload_date: string
        }
        Update: {
          tenant_id?: string
          total_bytes?: number | null
          upload_count?: number | null
          upload_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_uploads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
      security_audit_log: {
        Row: {
          created_at: string | null
          error_message: string | null
          event_type: string
          id: number
          ip_address: unknown
          metadata: Json | null
          request_method: string | null
          request_path: string | null
          resource_id: string | null
          resource_type: string | null
          severity: string
          target_tenant_id: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          event_type: string
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity: string
          target_tenant_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          target_tenant_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          daily_upload_limit: number | null
          id: string
          name: string
          processing_minutes_limit: number | null
          slug: string
          storage_quota_gb: number | null
          video_count_limit: number | null
        }
        Insert: {
          created_at?: string | null
          daily_upload_limit?: number | null
          id?: string
          name: string
          processing_minutes_limit?: number | null
          slug: string
          storage_quota_gb?: number | null
          video_count_limit?: number | null
        }
        Update: {
          created_at?: string | null
          daily_upload_limit?: number | null
          id?: string
          name?: string
          processing_minutes_limit?: number | null
          slug?: string
          storage_quota_gb?: number | null
          video_count_limit?: number | null
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
      usage_metrics: {
        Row: {
          cost_estimate_usd: number | null
          id: number
          metadata: Json | null
          metric_type: string
          metric_value: number
          recorded_at: string | null
          tenant_id: string | null
        }
        Insert: {
          cost_estimate_usd?: number | null
          id?: number
          metadata?: Json | null
          metric_type: string
          metric_value: number
          recorded_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          cost_estimate_usd?: number | null
          id?: number
          metadata?: Json | null
          metric_type?: string
          metric_value?: number
          recorded_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          access_notes: string | null
          access_tier_id: string | null
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
          invite_code_used: string | null
          role: string | null
          tenant_id: string | null
        }
        Insert: {
          access_notes?: string | null
          access_tier_id?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          invite_code_used?: string | null
          role?: string | null
          tenant_id?: string | null
        }
        Update: {
          access_notes?: string | null
          access_tier_id?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          invite_code_used?: string | null
          role?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_access_tier_id_fkey"
            columns: ["access_tier_id"]
            isOneToOne: false
            referencedRelation: "access_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_invite_code_used_fkey"
            columns: ["invite_code_used"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      video_database_state: {
        Row: {
          active_connection_id: string | null
          created_at: string | null
          database_name: string
          last_activity_at: string | null
          lock_holder_user_id: string | null
          lock_type: string | null
          locked_at: string | null
          server_version: number
          tenant_id: string
          updated_at: string | null
          video_id: string
          wasabi_synced_at: string | null
          wasabi_version: number
          working_copy_path: string | null
        }
        Insert: {
          active_connection_id?: string | null
          created_at?: string | null
          database_name: string
          last_activity_at?: string | null
          lock_holder_user_id?: string | null
          lock_type?: string | null
          locked_at?: string | null
          server_version?: number
          tenant_id: string
          updated_at?: string | null
          video_id: string
          wasabi_synced_at?: string | null
          wasabi_version?: number
          working_copy_path?: string | null
        }
        Update: {
          active_connection_id?: string | null
          created_at?: string | null
          database_name?: string
          last_activity_at?: string | null
          lock_holder_user_id?: string | null
          lock_type?: string | null
          locked_at?: string | null
          server_version?: number
          tenant_id?: string
          updated_at?: string | null
          video_id?: string
          wasabi_synced_at?: string | null
          wasabi_version?: number
          working_copy_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_database_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_database_state_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          boundaries_error_details: Json | null
          boundaries_status: string | null
          boundary_pending_count: number | null
          captions_db_key: string | null
          confirmed_annotations: number | null
          covered_frames: number | null
          current_cropped_frames_version: number | null
          deleted_at: string | null
          display_path: string | null
          duration_seconds: number | null
          height: number
          id: string
          is_demo: boolean | null
          layout_error_details: Json | null
          layout_status: string | null
          locked_at: string | null
          locked_by_user_id: string | null
          predicted_annotations: number | null
          prefect_flow_run_id: string | null
          size_bytes: number | null
          tenant_id: string | null
          text_error_details: Json | null
          text_pending_count: number | null
          text_status: string | null
          total_annotations: number | null
          total_frames: number | null
          uploaded_at: string | null
          uploaded_by_user_id: string | null
          width: number
        }
        Insert: {
          boundaries_error_details?: Json | null
          boundaries_status?: string | null
          boundary_pending_count?: number | null
          captions_db_key?: string | null
          confirmed_annotations?: number | null
          covered_frames?: number | null
          current_cropped_frames_version?: number | null
          deleted_at?: string | null
          display_path?: string | null
          duration_seconds?: number | null
          height?: number
          id?: string
          is_demo?: boolean | null
          layout_error_details?: Json | null
          layout_status?: string | null
          locked_at?: string | null
          locked_by_user_id?: string | null
          predicted_annotations?: number | null
          prefect_flow_run_id?: string | null
          size_bytes?: number | null
          tenant_id?: string | null
          text_error_details?: Json | null
          text_pending_count?: number | null
          text_status?: string | null
          total_annotations?: number | null
          total_frames?: number | null
          uploaded_at?: string | null
          uploaded_by_user_id?: string | null
          width?: number
        }
        Update: {
          boundaries_error_details?: Json | null
          boundaries_status?: string | null
          boundary_pending_count?: number | null
          captions_db_key?: string | null
          confirmed_annotations?: number | null
          covered_frames?: number | null
          current_cropped_frames_version?: number | null
          deleted_at?: string | null
          display_path?: string | null
          duration_seconds?: number | null
          height?: number
          id?: string
          is_demo?: boolean | null
          layout_error_details?: Json | null
          layout_status?: string | null
          locked_at?: string | null
          locked_by_user_id?: string | null
          predicted_annotations?: number | null
          prefect_flow_run_id?: string | null
          size_bytes?: number | null
          tenant_id?: string | null
          text_error_details?: Json | null
          text_pending_count?: number | null
          text_status?: string | null
          total_annotations?: number | null
          total_frames?: number | null
          uploaded_at?: string | null
          uploaded_by_user_id?: string | null
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "videos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
      current_user_role: { Args: never; Returns: string }
      current_user_tenant_id: { Args: never; Returns: string }
      get_next_cropped_frames_version: {
        Args: { p_video_id: string }
        Returns: number
      }
      has_feature_access: {
        Args: { p_feature: string; p_user_id: string }
        Returns: boolean
      }
      is_current_user_approved: { Args: never; Returns: boolean }
      is_current_user_owner: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
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
      [_ in never]: never
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
      agent: {
        Row: {
          created: string
          id: string
          last_activity_time: string
          name: string
          updated: string
          work_queue_id: string
        }
        Insert: {
          created?: string
          id?: string
          last_activity_time?: string
          name: string
          updated?: string
          work_queue_id: string
        }
        Update: {
          created?: string
          id?: string
          last_activity_time?: string
          name?: string
          updated?: string
          work_queue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_agent__work_queue_id__work_queue"
            columns: ["work_queue_id"]
            isOneToOne: false
            referencedRelation: "work_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      alembic_version: {
        Row: {
          version_num: string
        }
        Insert: {
          version_num: string
        }
        Update: {
          version_num?: string
        }
        Relationships: []
      }
      artifact: {
        Row: {
          created: string
          data: Json | null
          description: string | null
          flow_run_id: string | null
          id: string
          key: string | null
          metadata_: Json | null
          task_run_id: string | null
          type: string | null
          updated: string
        }
        Insert: {
          created?: string
          data?: Json | null
          description?: string | null
          flow_run_id?: string | null
          id?: string
          key?: string | null
          metadata_?: Json | null
          task_run_id?: string | null
          type?: string | null
          updated?: string
        }
        Update: {
          created?: string
          data?: Json | null
          description?: string | null
          flow_run_id?: string | null
          id?: string
          key?: string | null
          metadata_?: Json | null
          task_run_id?: string | null
          type?: string | null
          updated?: string
        }
        Relationships: []
      }
      artifact_collection: {
        Row: {
          created: string
          data: Json | null
          description: string | null
          flow_run_id: string | null
          id: string
          key: string
          latest_id: string
          metadata_: Json | null
          task_run_id: string | null
          type: string | null
          updated: string
        }
        Insert: {
          created?: string
          data?: Json | null
          description?: string | null
          flow_run_id?: string | null
          id?: string
          key: string
          latest_id: string
          metadata_?: Json | null
          task_run_id?: string | null
          type?: string | null
          updated?: string
        }
        Update: {
          created?: string
          data?: Json | null
          description?: string | null
          flow_run_id?: string | null
          id?: string
          key?: string
          latest_id?: string
          metadata_?: Json | null
          task_run_id?: string | null
          type?: string | null
          updated?: string
        }
        Relationships: []
      }
      automation: {
        Row: {
          actions: Json
          actions_on_resolve: Json
          actions_on_trigger: Json
          created: string
          description: string
          enabled: boolean
          id: string
          name: string
          tags: Json
          trigger: Json
          updated: string
        }
        Insert: {
          actions: Json
          actions_on_resolve?: Json
          actions_on_trigger?: Json
          created?: string
          description: string
          enabled?: boolean
          id?: string
          name: string
          tags?: Json
          trigger: Json
          updated?: string
        }
        Update: {
          actions?: Json
          actions_on_resolve?: Json
          actions_on_trigger?: Json
          created?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          tags?: Json
          trigger?: Json
          updated?: string
        }
        Relationships: []
      }
      automation_bucket: {
        Row: {
          automation_id: string
          bucketing_key: Json
          count: number
          created: string
          end: string
          id: string
          last_event: Json | null
          last_operation: string | null
          start: string
          trigger_id: string
          triggered_at: string | null
          updated: string
        }
        Insert: {
          automation_id: string
          bucketing_key: Json
          count: number
          created?: string
          end: string
          id?: string
          last_event?: Json | null
          last_operation?: string | null
          start: string
          trigger_id: string
          triggered_at?: string | null
          updated?: string
        }
        Update: {
          automation_id?: string
          bucketing_key?: Json
          count?: number
          created?: string
          end?: string
          id?: string
          last_event?: Json | null
          last_operation?: string | null
          start?: string
          trigger_id?: string
          triggered_at?: string | null
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_automation_bucket__automation_id__automation"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_event_follower: {
        Row: {
          created: string
          follower: Json
          follower_event_id: string
          id: string
          leader_event_id: string
          received: string
          scope: string
          updated: string
        }
        Insert: {
          created?: string
          follower: Json
          follower_event_id: string
          id?: string
          leader_event_id: string
          received: string
          scope: string
          updated?: string
        }
        Update: {
          created?: string
          follower?: Json
          follower_event_id?: string
          id?: string
          leader_event_id?: string
          received?: string
          scope?: string
          updated?: string
        }
        Relationships: []
      }
      automation_related_resource: {
        Row: {
          automation_id: string
          automation_owned_by_resource: boolean
          created: string
          id: string
          resource_id: string | null
          updated: string
        }
        Insert: {
          automation_id: string
          automation_owned_by_resource?: boolean
          created?: string
          id?: string
          resource_id?: string | null
          updated?: string
        }
        Update: {
          automation_id?: string
          automation_owned_by_resource?: boolean
          created?: string
          id?: string
          resource_id?: string | null
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_automation_related_resource__automation_id__automation"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation"
            referencedColumns: ["id"]
          },
        ]
      }
      block_document: {
        Row: {
          block_schema_id: string
          block_type_id: string
          block_type_name: string | null
          created: string
          data: Json
          id: string
          is_anonymous: boolean
          name: string
          updated: string
        }
        Insert: {
          block_schema_id: string
          block_type_id: string
          block_type_name?: string | null
          created?: string
          data?: Json
          id?: string
          is_anonymous?: boolean
          name: string
          updated?: string
        }
        Update: {
          block_schema_id?: string
          block_type_id?: string
          block_type_name?: string | null
          created?: string
          data?: Json
          id?: string
          is_anonymous?: boolean
          name?: string
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_block__block_schema_id__block_schema"
            columns: ["block_schema_id"]
            isOneToOne: false
            referencedRelation: "block_schema"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_block_document__block_type_id__block_type"
            columns: ["block_type_id"]
            isOneToOne: false
            referencedRelation: "block_type"
            referencedColumns: ["id"]
          },
        ]
      }
      block_document_reference: {
        Row: {
          created: string
          id: string
          name: string
          parent_block_document_id: string
          reference_block_document_id: string
          updated: string
        }
        Insert: {
          created?: string
          id?: string
          name: string
          parent_block_document_id: string
          reference_block_document_id: string
          updated?: string
        }
        Update: {
          created?: string
          id?: string
          name?: string
          parent_block_document_id?: string
          reference_block_document_id?: string
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_block_document_reference__parent_block_document_id___328f"
            columns: ["parent_block_document_id"]
            isOneToOne: false
            referencedRelation: "block_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_block_document_reference__reference_block_document_i_5759"
            columns: ["reference_block_document_id"]
            isOneToOne: false
            referencedRelation: "block_document"
            referencedColumns: ["id"]
          },
        ]
      }
      block_schema: {
        Row: {
          block_type_id: string
          capabilities: Json
          checksum: string
          created: string
          fields: Json
          id: string
          updated: string
          version: string
        }
        Insert: {
          block_type_id: string
          capabilities?: Json
          checksum: string
          created?: string
          fields?: Json
          id?: string
          updated?: string
          version?: string
        }
        Update: {
          block_type_id?: string
          capabilities?: Json
          checksum?: string
          created?: string
          fields?: Json
          id?: string
          updated?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_block_schema__block_type_id__block_type"
            columns: ["block_type_id"]
            isOneToOne: false
            referencedRelation: "block_type"
            referencedColumns: ["id"]
          },
        ]
      }
      block_schema_reference: {
        Row: {
          created: string
          id: string
          name: string
          parent_block_schema_id: string
          reference_block_schema_id: string
          updated: string
        }
        Insert: {
          created?: string
          id?: string
          name: string
          parent_block_schema_id: string
          reference_block_schema_id: string
          updated?: string
        }
        Update: {
          created?: string
          id?: string
          name?: string
          parent_block_schema_id?: string
          reference_block_schema_id?: string
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_block_schema_reference__parent_block_schema_id__block_schema"
            columns: ["parent_block_schema_id"]
            isOneToOne: false
            referencedRelation: "block_schema"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_block_schema_reference__reference_block_schema_id__b_6e5d"
            columns: ["reference_block_schema_id"]
            isOneToOne: false
            referencedRelation: "block_schema"
            referencedColumns: ["id"]
          },
        ]
      }
      block_type: {
        Row: {
          code_example: string | null
          created: string
          description: string | null
          documentation_url: string | null
          id: string
          is_protected: boolean
          logo_url: string | null
          name: string
          slug: string
          updated: string
        }
        Insert: {
          code_example?: string | null
          created?: string
          description?: string | null
          documentation_url?: string | null
          id?: string
          is_protected?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated?: string
        }
        Update: {
          code_example?: string | null
          created?: string
          description?: string | null
          documentation_url?: string | null
          id?: string
          is_protected?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated?: string
        }
        Relationships: []
      }
      composite_trigger_child_firing: {
        Row: {
          automation_id: string
          child_fired_at: string | null
          child_firing: Json
          child_firing_id: string
          child_trigger_id: string
          created: string
          id: string
          parent_trigger_id: string
          updated: string
        }
        Insert: {
          automation_id: string
          child_fired_at?: string | null
          child_firing: Json
          child_firing_id: string
          child_trigger_id: string
          created?: string
          id?: string
          parent_trigger_id: string
          updated?: string
        }
        Update: {
          automation_id?: string
          child_fired_at?: string | null
          child_firing?: Json
          child_firing_id?: string
          child_trigger_id?: string
          created?: string
          id?: string
          parent_trigger_id?: string
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_composite_trigger_child_firing__automation_id__automation"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation"
            referencedColumns: ["id"]
          },
        ]
      }
      concurrency_limit: {
        Row: {
          active_slots: Json
          concurrency_limit: number
          created: string
          id: string
          tag: string
          updated: string
        }
        Insert: {
          active_slots?: Json
          concurrency_limit: number
          created?: string
          id?: string
          tag: string
          updated?: string
        }
        Update: {
          active_slots?: Json
          concurrency_limit?: number
          created?: string
          id?: string
          tag?: string
          updated?: string
        }
        Relationships: []
      }
      concurrency_limit_v2: {
        Row: {
          active: boolean
          active_slots: number
          avg_slot_occupancy_seconds: number
          created: string
          denied_slots: number
          id: string
          limit: number
          name: string
          slot_decay_per_second: number
          updated: string
        }
        Insert: {
          active: boolean
          active_slots: number
          avg_slot_occupancy_seconds: number
          created?: string
          denied_slots: number
          id?: string
          limit: number
          name: string
          slot_decay_per_second: number
          updated?: string
        }
        Update: {
          active?: boolean
          active_slots?: number
          avg_slot_occupancy_seconds?: number
          created?: string
          denied_slots?: number
          id?: string
          limit?: number
          name?: string
          slot_decay_per_second?: number
          updated?: string
        }
        Relationships: []
      }
      configuration: {
        Row: {
          created: string
          id: string
          key: string
          updated: string
          value: Json
        }
        Insert: {
          created?: string
          id?: string
          key: string
          updated?: string
          value: Json
        }
        Update: {
          created?: string
          id?: string
          key?: string
          updated?: string
          value?: Json
        }
        Relationships: []
      }
      csrf_token: {
        Row: {
          client: string
          created: string
          expiration: string
          id: string
          token: string
          updated: string
        }
        Insert: {
          client: string
          created?: string
          expiration: string
          id?: string
          token: string
          updated?: string
        }
        Update: {
          client?: string
          created?: string
          expiration?: string
          id?: string
          token?: string
          updated?: string
        }
        Relationships: []
      }
      deployment: {
        Row: {
          concurrency_limit: number | null
          concurrency_limit_id: string | null
          concurrency_options: Json | null
          created: string
          created_by: Json | null
          description: string | null
          enforce_parameter_schema: boolean
          entrypoint: string | null
          flow_id: string
          id: string
          infra_overrides: Json
          infrastructure_document_id: string | null
          labels: Json | null
          last_polled: string | null
          name: string
          parameter_openapi_schema: Json | null
          parameters: Json
          path: string | null
          paused: boolean
          pull_steps: Json | null
          status: Database["public"]["Enums"]["deployment_status"]
          storage_document_id: string | null
          tags: Json
          updated: string
          updated_by: Json | null
          version: string | null
          version_id: string | null
          work_queue_id: string | null
          work_queue_name: string | null
        }
        Insert: {
          concurrency_limit?: number | null
          concurrency_limit_id?: string | null
          concurrency_options?: Json | null
          created?: string
          created_by?: Json | null
          description?: string | null
          enforce_parameter_schema?: boolean
          entrypoint?: string | null
          flow_id: string
          id?: string
          infra_overrides?: Json
          infrastructure_document_id?: string | null
          labels?: Json | null
          last_polled?: string | null
          name: string
          parameter_openapi_schema?: Json | null
          parameters?: Json
          path?: string | null
          paused?: boolean
          pull_steps?: Json | null
          status?: Database["public"]["Enums"]["deployment_status"]
          storage_document_id?: string | null
          tags?: Json
          updated?: string
          updated_by?: Json | null
          version?: string | null
          version_id?: string | null
          work_queue_id?: string | null
          work_queue_name?: string | null
        }
        Update: {
          concurrency_limit?: number | null
          concurrency_limit_id?: string | null
          concurrency_options?: Json | null
          created?: string
          created_by?: Json | null
          description?: string | null
          enforce_parameter_schema?: boolean
          entrypoint?: string | null
          flow_id?: string
          id?: string
          infra_overrides?: Json
          infrastructure_document_id?: string | null
          labels?: Json | null
          last_polled?: string | null
          name?: string
          parameter_openapi_schema?: Json | null
          parameters?: Json
          path?: string | null
          paused?: boolean
          pull_steps?: Json | null
          status?: Database["public"]["Enums"]["deployment_status"]
          storage_document_id?: string | null
          tags?: Json
          updated?: string
          updated_by?: Json | null
          version?: string | null
          version_id?: string | null
          work_queue_id?: string | null
          work_queue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_deployment__concurrency_limit_id__concurrency_limit_v2"
            columns: ["concurrency_limit_id"]
            isOneToOne: false
            referencedRelation: "concurrency_limit_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_deployment__flow_id__flow"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_deployment__infrastructure_document_id__block_document"
            columns: ["infrastructure_document_id"]
            isOneToOne: false
            referencedRelation: "block_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_deployment__storage_document_id__block_document"
            columns: ["storage_document_id"]
            isOneToOne: false
            referencedRelation: "block_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_deployment__work_queue_id__work_queue"
            columns: ["work_queue_id"]
            isOneToOne: false
            referencedRelation: "work_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_schedule: {
        Row: {
          active: boolean
          created: string
          deployment_id: string
          id: string
          max_scheduled_runs: number | null
          parameters: Json
          schedule: Json
          slug: string | null
          updated: string
        }
        Insert: {
          active: boolean
          created?: string
          deployment_id: string
          id?: string
          max_scheduled_runs?: number | null
          parameters?: Json
          schedule: Json
          slug?: string | null
          updated?: string
        }
        Update: {
          active?: boolean
          created?: string
          deployment_id?: string
          id?: string
          max_scheduled_runs?: number | null
          parameters?: Json
          schedule?: Json
          slug?: string | null
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_deployment_schedule__deployment_id__deployment"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "deployment"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_version: {
        Row: {
          branch: string | null
          created: string
          deployment_id: string
          description: string | null
          enforce_parameter_schema: boolean
          entrypoint: string | null
          id: string
          infra_overrides: Json
          labels: Json | null
          parameter_openapi_schema: Json | null
          parameters: Json
          pull_steps: Json | null
          tags: Json
          updated: string
          version_info: Json
          work_queue_id: string | null
          work_queue_name: string | null
        }
        Insert: {
          branch?: string | null
          created?: string
          deployment_id: string
          description?: string | null
          enforce_parameter_schema?: boolean
          entrypoint?: string | null
          id?: string
          infra_overrides?: Json
          labels?: Json | null
          parameter_openapi_schema?: Json | null
          parameters?: Json
          pull_steps?: Json | null
          tags?: Json
          updated?: string
          version_info?: Json
          work_queue_id?: string | null
          work_queue_name?: string | null
        }
        Update: {
          branch?: string | null
          created?: string
          deployment_id?: string
          description?: string | null
          enforce_parameter_schema?: boolean
          entrypoint?: string | null
          id?: string
          infra_overrides?: Json
          labels?: Json | null
          parameter_openapi_schema?: Json | null
          parameters?: Json
          pull_steps?: Json | null
          tags?: Json
          updated?: string
          version_info?: Json
          work_queue_id?: string | null
          work_queue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_deployment_version__deployment_id__deployment"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "deployment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_deployment_version__work_queue_id__work_queue"
            columns: ["work_queue_id"]
            isOneToOne: false
            referencedRelation: "work_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      event_resources: {
        Row: {
          created: string
          event_id: string
          id: string
          occurred: string
          resource: Json
          resource_id: string
          resource_role: string
          updated: string
        }
        Insert: {
          created?: string
          event_id: string
          id?: string
          occurred: string
          resource: Json
          resource_id: string
          resource_role: string
          updated?: string
        }
        Update: {
          created?: string
          event_id?: string
          id?: string
          occurred?: string
          resource?: Json
          resource_id?: string
          resource_role?: string
          updated?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created: string
          event: string
          follows: string | null
          id: string
          occurred: string
          payload: Json
          received: string
          recorded: string
          related: Json
          related_resource_ids: Json
          resource: Json
          resource_id: string
          updated: string
        }
        Insert: {
          created?: string
          event: string
          follows?: string | null
          id?: string
          occurred: string
          payload: Json
          received: string
          recorded: string
          related?: Json
          related_resource_ids?: Json
          resource: Json
          resource_id: string
          updated?: string
        }
        Update: {
          created?: string
          event?: string
          follows?: string | null
          id?: string
          occurred?: string
          payload?: Json
          received?: string
          recorded?: string
          related?: Json
          related_resource_ids?: Json
          resource?: Json
          resource_id?: string
          updated?: string
        }
        Relationships: []
      }
      flow: {
        Row: {
          created: string
          id: string
          labels: Json | null
          name: string
          tags: Json
          updated: string
        }
        Insert: {
          created?: string
          id?: string
          labels?: Json | null
          name: string
          tags?: Json
          updated?: string
        }
        Update: {
          created?: string
          id?: string
          labels?: Json | null
          name?: string
          tags?: Json
          updated?: string
        }
        Relationships: []
      }
      flow_run: {
        Row: {
          auto_scheduled: boolean
          context: Json
          created: string
          created_by: Json | null
          deployment_id: string | null
          deployment_version: string | null
          empirical_policy: Json
          end_time: string | null
          expected_start_time: string | null
          flow_id: string
          flow_version: string | null
          id: string
          idempotency_key: string | null
          infrastructure_document_id: string | null
          infrastructure_pid: string | null
          job_variables: Json | null
          labels: Json | null
          name: string
          next_scheduled_start_time: string | null
          parameters: Json
          parent_task_run_id: string | null
          run_count: number
          start_time: string | null
          state_id: string | null
          state_name: string | null
          state_timestamp: string | null
          state_type: Database["public"]["Enums"]["state_type"] | null
          tags: Json
          total_run_time: unknown
          updated: string
          work_queue_id: string | null
          work_queue_name: string | null
        }
        Insert: {
          auto_scheduled?: boolean
          context?: Json
          created?: string
          created_by?: Json | null
          deployment_id?: string | null
          deployment_version?: string | null
          empirical_policy?: Json
          end_time?: string | null
          expected_start_time?: string | null
          flow_id: string
          flow_version?: string | null
          id?: string
          idempotency_key?: string | null
          infrastructure_document_id?: string | null
          infrastructure_pid?: string | null
          job_variables?: Json | null
          labels?: Json | null
          name: string
          next_scheduled_start_time?: string | null
          parameters?: Json
          parent_task_run_id?: string | null
          run_count?: number
          start_time?: string | null
          state_id?: string | null
          state_name?: string | null
          state_timestamp?: string | null
          state_type?: Database["public"]["Enums"]["state_type"] | null
          tags?: Json
          total_run_time?: unknown
          updated?: string
          work_queue_id?: string | null
          work_queue_name?: string | null
        }
        Update: {
          auto_scheduled?: boolean
          context?: Json
          created?: string
          created_by?: Json | null
          deployment_id?: string | null
          deployment_version?: string | null
          empirical_policy?: Json
          end_time?: string | null
          expected_start_time?: string | null
          flow_id?: string
          flow_version?: string | null
          id?: string
          idempotency_key?: string | null
          infrastructure_document_id?: string | null
          infrastructure_pid?: string | null
          job_variables?: Json | null
          labels?: Json | null
          name?: string
          next_scheduled_start_time?: string | null
          parameters?: Json
          parent_task_run_id?: string | null
          run_count?: number
          start_time?: string | null
          state_id?: string | null
          state_name?: string | null
          state_timestamp?: string | null
          state_type?: Database["public"]["Enums"]["state_type"] | null
          tags?: Json
          total_run_time?: unknown
          updated?: string
          work_queue_id?: string | null
          work_queue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_flow_run__flow_id__flow"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flow"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_flow_run__infrastructure_document_id__block_document"
            columns: ["infrastructure_document_id"]
            isOneToOne: false
            referencedRelation: "block_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_flow_run__parent_task_run_id__task_run"
            columns: ["parent_task_run_id"]
            isOneToOne: false
            referencedRelation: "task_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_flow_run__state_id__flow_run_state"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "flow_run_state"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_flow_run__work_queue_id__work_queue"
            columns: ["work_queue_id"]
            isOneToOne: false
            referencedRelation: "work_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_run_input: {
        Row: {
          created: string
          flow_run_id: string
          id: string
          key: string
          sender: string | null
          updated: string
          value: string
        }
        Insert: {
          created?: string
          flow_run_id: string
          id?: string
          key: string
          sender?: string | null
          updated?: string
          value: string
        }
        Update: {
          created?: string
          flow_run_id?: string
          id?: string
          key?: string
          sender?: string | null
          updated?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_flow_run_input__flow_run_id__flow_run"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "flow_run"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_run_state: {
        Row: {
          created: string
          data: Json | null
          flow_run_id: string
          id: string
          message: string | null
          name: string
          result_artifact_id: string | null
          state_details: Json
          timestamp: string
          type: Database["public"]["Enums"]["state_type"]
          updated: string
        }
        Insert: {
          created?: string
          data?: Json | null
          flow_run_id: string
          id?: string
          message?: string | null
          name: string
          result_artifact_id?: string | null
          state_details?: Json
          timestamp?: string
          type: Database["public"]["Enums"]["state_type"]
          updated?: string
        }
        Update: {
          created?: string
          data?: Json | null
          flow_run_id?: string
          id?: string
          message?: string | null
          name?: string
          result_artifact_id?: string | null
          state_details?: Json
          timestamp?: string
          type?: Database["public"]["Enums"]["state_type"]
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_flow_run_state__flow_run_id__flow_run"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "flow_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_flow_run_state__result_artifact_id__artifact"
            columns: ["result_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifact"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_tokens: {
        Row: {
          backend: string | null
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string
          id: string
          is_active: boolean
          jti: string
          last_used_at: string | null
          metadata: Json | null
          project: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          service: string
          token_hash: string
        }
        Insert: {
          backend?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at: string
          id?: string
          is_active?: boolean
          jti: string
          last_used_at?: string | null
          metadata?: Json | null
          project: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          service: string
          token_hash: string
        }
        Update: {
          backend?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string
          id?: string
          is_active?: boolean
          jti?: string
          last_used_at?: string | null
          metadata?: Json | null
          project?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          service?: string
          token_hash?: string
        }
        Relationships: []
      }
      gateway_tokens_revoked: {
        Row: {
          expires_at: string
          jti: string
          reason: string | null
          revoked_at: string
        }
        Insert: {
          expires_at: string
          jti: string
          reason?: string | null
          revoked_at?: string
        }
        Update: {
          expires_at?: string
          jti?: string
          reason?: string | null
          revoked_at?: string
        }
        Relationships: []
      }
      log: {
        Row: {
          created: string
          flow_run_id: string | null
          id: string
          level: number
          message: string
          name: string
          task_run_id: string | null
          timestamp: string
          updated: string
        }
        Insert: {
          created?: string
          flow_run_id?: string | null
          id?: string
          level: number
          message: string
          name: string
          task_run_id?: string | null
          timestamp: string
          updated?: string
        }
        Update: {
          created?: string
          flow_run_id?: string | null
          id?: string
          level?: number
          message?: string
          name?: string
          task_run_id?: string | null
          timestamp?: string
          updated?: string
        }
        Relationships: []
      }
      saved_search: {
        Row: {
          created: string
          filters: Json
          id: string
          name: string
          updated: string
        }
        Insert: {
          created?: string
          filters?: Json
          id?: string
          name: string
          updated?: string
        }
        Update: {
          created?: string
          filters?: Json
          id?: string
          name?: string
          updated?: string
        }
        Relationships: []
      }
      task_run: {
        Row: {
          cache_expiration: string | null
          cache_key: string | null
          created: string
          dynamic_key: string
          empirical_policy: Json
          end_time: string | null
          expected_start_time: string | null
          flow_run_id: string | null
          flow_run_run_count: number
          id: string
          labels: Json | null
          name: string
          next_scheduled_start_time: string | null
          run_count: number
          start_time: string | null
          state_id: string | null
          state_name: string | null
          state_timestamp: string | null
          state_type: Database["public"]["Enums"]["state_type"] | null
          tags: Json
          task_inputs: Json
          task_key: string
          task_version: string | null
          total_run_time: unknown
          updated: string
        }
        Insert: {
          cache_expiration?: string | null
          cache_key?: string | null
          created?: string
          dynamic_key: string
          empirical_policy?: Json
          end_time?: string | null
          expected_start_time?: string | null
          flow_run_id?: string | null
          flow_run_run_count?: number
          id?: string
          labels?: Json | null
          name: string
          next_scheduled_start_time?: string | null
          run_count?: number
          start_time?: string | null
          state_id?: string | null
          state_name?: string | null
          state_timestamp?: string | null
          state_type?: Database["public"]["Enums"]["state_type"] | null
          tags?: Json
          task_inputs?: Json
          task_key: string
          task_version?: string | null
          total_run_time?: unknown
          updated?: string
        }
        Update: {
          cache_expiration?: string | null
          cache_key?: string | null
          created?: string
          dynamic_key?: string
          empirical_policy?: Json
          end_time?: string | null
          expected_start_time?: string | null
          flow_run_id?: string | null
          flow_run_run_count?: number
          id?: string
          labels?: Json | null
          name?: string
          next_scheduled_start_time?: string | null
          run_count?: number
          start_time?: string | null
          state_id?: string | null
          state_name?: string | null
          state_timestamp?: string | null
          state_type?: Database["public"]["Enums"]["state_type"] | null
          tags?: Json
          task_inputs?: Json
          task_key?: string
          task_version?: string | null
          total_run_time?: unknown
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_task_run__flow_run_id__flow_run"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "flow_run"
            referencedColumns: ["id"]
          },
        ]
      }
      task_run_state: {
        Row: {
          created: string
          data: Json | null
          id: string
          message: string | null
          name: string
          result_artifact_id: string | null
          state_details: Json
          task_run_id: string
          timestamp: string
          type: Database["public"]["Enums"]["state_type"]
          updated: string
        }
        Insert: {
          created?: string
          data?: Json | null
          id?: string
          message?: string | null
          name: string
          result_artifact_id?: string | null
          state_details?: Json
          task_run_id: string
          timestamp?: string
          type: Database["public"]["Enums"]["state_type"]
          updated?: string
        }
        Update: {
          created?: string
          data?: Json | null
          id?: string
          message?: string | null
          name?: string
          result_artifact_id?: string | null
          state_details?: Json
          task_run_id?: string
          timestamp?: string
          type?: Database["public"]["Enums"]["state_type"]
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_task_run_state__result_artifact_id__artifact"
            columns: ["result_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_task_run_state__task_run_id__task_run"
            columns: ["task_run_id"]
            isOneToOne: false
            referencedRelation: "task_run"
            referencedColumns: ["id"]
          },
        ]
      }
      task_run_state_cache: {
        Row: {
          cache_expiration: string | null
          cache_key: string
          created: string
          id: string
          task_run_state_id: string
          updated: string
        }
        Insert: {
          cache_expiration?: string | null
          cache_key: string
          created?: string
          id?: string
          task_run_state_id: string
          updated?: string
        }
        Update: {
          cache_expiration?: string | null
          cache_key?: string
          created?: string
          id?: string
          task_run_state_id?: string
          updated?: string
        }
        Relationships: []
      }
      variable: {
        Row: {
          created: string
          id: string
          name: string
          tags: Json
          updated: string
          value: Json | null
        }
        Insert: {
          created?: string
          id?: string
          name: string
          tags?: Json
          updated?: string
          value?: Json | null
        }
        Update: {
          created?: string
          id?: string
          name?: string
          tags?: Json
          updated?: string
          value?: Json | null
        }
        Relationships: []
      }
      work_pool: {
        Row: {
          base_job_template: Json
          concurrency_limit: number | null
          created: string
          default_queue_id: string | null
          description: string | null
          id: string
          is_paused: boolean
          last_status_event_id: string | null
          last_transitioned_status_at: string | null
          name: string
          status: Database["public"]["Enums"]["work_pool_status"]
          storage_configuration: Json
          type: string
          updated: string
        }
        Insert: {
          base_job_template?: Json
          concurrency_limit?: number | null
          created?: string
          default_queue_id?: string | null
          description?: string | null
          id?: string
          is_paused?: boolean
          last_status_event_id?: string | null
          last_transitioned_status_at?: string | null
          name: string
          status?: Database["public"]["Enums"]["work_pool_status"]
          storage_configuration?: Json
          type: string
          updated?: string
        }
        Update: {
          base_job_template?: Json
          concurrency_limit?: number | null
          created?: string
          default_queue_id?: string | null
          description?: string | null
          id?: string
          is_paused?: boolean
          last_status_event_id?: string | null
          last_transitioned_status_at?: string | null
          name?: string
          status?: Database["public"]["Enums"]["work_pool_status"]
          storage_configuration?: Json
          type?: string
          updated?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_work_pool__default_queue_id__work_queue"
            columns: ["default_queue_id"]
            isOneToOne: false
            referencedRelation: "work_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      work_queue: {
        Row: {
          concurrency_limit: number | null
          created: string
          description: string
          filter: Json | null
          id: string
          is_paused: boolean
          last_polled: string | null
          name: string
          priority: number
          status: Database["public"]["Enums"]["work_queue_status"]
          updated: string
          work_pool_id: string
        }
        Insert: {
          concurrency_limit?: number | null
          created?: string
          description?: string
          filter?: Json | null
          id?: string
          is_paused?: boolean
          last_polled?: string | null
          name: string
          priority?: number
          status?: Database["public"]["Enums"]["work_queue_status"]
          updated?: string
          work_pool_id: string
        }
        Update: {
          concurrency_limit?: number | null
          created?: string
          description?: string
          filter?: Json | null
          id?: string
          is_paused?: boolean
          last_polled?: string | null
          name?: string
          priority?: number
          status?: Database["public"]["Enums"]["work_queue_status"]
          updated?: string
          work_pool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_work_queue__work_pool_id__work_pool"
            columns: ["work_pool_id"]
            isOneToOne: false
            referencedRelation: "work_pool"
            referencedColumns: ["id"]
          },
        ]
      }
      worker: {
        Row: {
          created: string
          heartbeat_interval_seconds: number | null
          id: string
          last_heartbeat_time: string
          name: string
          status: Database["public"]["Enums"]["worker_status"]
          updated: string
          work_pool_id: string
        }
        Insert: {
          created?: string
          heartbeat_interval_seconds?: number | null
          id?: string
          last_heartbeat_time?: string
          name: string
          status?: Database["public"]["Enums"]["worker_status"]
          updated?: string
          work_pool_id: string
        }
        Update: {
          created?: string
          heartbeat_interval_seconds?: number | null
          id?: string
          last_heartbeat_time?: string
          name?: string
          status?: Database["public"]["Enums"]["worker_status"]
          updated?: string
          work_pool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_worker__work_pool_id__work_pool"
            columns: ["work_pool_id"]
            isOneToOne: false
            referencedRelation: "work_pool"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_revocations: { Args: never; Returns: number }
      is_token_revoked: { Args: { token_jti: string }; Returns: boolean }
      revoke_gateway_token: {
        Args: { reason?: string; revoked_by_user?: string; token_jti: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_token_usage: { Args: { token_jti: string }; Returns: undefined }
    }
    Enums: {
      deployment_status: "READY" | "NOT_READY"
      state_type:
        | "SCHEDULED"
        | "PENDING"
        | "RUNNING"
        | "COMPLETED"
        | "FAILED"
        | "CANCELLED"
        | "CRASHED"
        | "PAUSED"
        | "CANCELLING"
      work_pool_status: "READY" | "NOT_READY" | "PAUSED"
      work_queue_status: "READY" | "NOT_READY" | "PAUSED"
      worker_status: "ONLINE" | "OFFLINE"
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
          type: Database["storage"]["Enums"]["buckettype"]
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
          type?: Database["storage"]["Enums"]["buckettype"]
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
          type?: Database["storage"]["Enums"]["buckettype"]
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
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
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
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
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
            foreignKeyName: "prefixes_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
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
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
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
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
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
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
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
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
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
    Enums: {
      deployment_status: ["READY", "NOT_READY"],
      state_type: [
        "SCHEDULED",
        "PENDING",
        "RUNNING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "CRASHED",
        "PAUSED",
        "CANCELLING",
      ],
      work_pool_status: ["READY", "NOT_READY", "PAUSED"],
      work_queue_status: ["READY", "NOT_READY", "PAUSED"],
      worker_status: ["ONLINE", "OFFLINE"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
