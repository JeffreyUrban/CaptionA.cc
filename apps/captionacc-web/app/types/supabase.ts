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
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            foreignKeyName: "video_search_index_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
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
} as const
