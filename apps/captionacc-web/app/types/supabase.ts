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
          display_path: string | null
          duration_seconds: number | null
          filename: string
          id: string
          is_demo: boolean | null
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
          display_path?: string | null
          duration_seconds?: number | null
          filename: string
          id?: string
          is_demo?: boolean | null
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
          display_path?: string | null
          duration_seconds?: number | null
          filename?: string
          id?: string
          is_demo?: boolean | null
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
      security_metrics: {
        Row: {
          event_count: number | null
          event_type: string | null
          severity: string | null
          time_bucket: string | null
          unique_tenants: number | null
          unique_users: number | null
        }
        Relationships: []
      }
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
