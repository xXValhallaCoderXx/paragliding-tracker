export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      flights: {
        Row: {
          client_created_at: number
          client_updated_at: number
          created_at: string
          device_platform: string | null
          duration_ms: number | null
          ended_at: number | null
          equipment_snapshot: Json | null
          fix_count: number | null
          id: string
          igc_artifact_version: number | null
          igc_byte_count: number | null
          igc_object_path: string | null
          igc_sha256: string | null
          max_gps_altitude: number | null
          max_ground_speed: number | null
          max_source_gap_ms: number | null
          median_source_gap_ms: number | null
          metrics_algorithm_version: number | null
          metrics_computed_at: number | null
          min_gps_altitude: number | null
          notes: string | null
          p95_source_gap_ms: number | null
          quality: Database["public"]["Enums"]["track_quality"] | null
          recorder_schema_version: number | null
          recording_session_id: string
          site: string | null
          site_source: string | null
          started_at: number
          status: Database["public"]["Enums"]["flight_status"]
          timezone_offset_minutes: number | null
          title: string | null
          track_distance_metres: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_created_at: number
          client_updated_at: number
          created_at?: string
          device_platform?: string | null
          duration_ms?: number | null
          ended_at?: number | null
          equipment_snapshot?: Json | null
          fix_count?: number | null
          id: string
          igc_artifact_version?: number | null
          igc_byte_count?: number | null
          igc_object_path?: string | null
          igc_sha256?: string | null
          max_gps_altitude?: number | null
          max_ground_speed?: number | null
          max_source_gap_ms?: number | null
          median_source_gap_ms?: number | null
          metrics_algorithm_version?: number | null
          metrics_computed_at?: number | null
          min_gps_altitude?: number | null
          notes?: string | null
          p95_source_gap_ms?: number | null
          quality?: Database["public"]["Enums"]["track_quality"] | null
          recorder_schema_version?: number | null
          recording_session_id: string
          site?: string | null
          site_source?: string | null
          started_at: number
          status: Database["public"]["Enums"]["flight_status"]
          timezone_offset_minutes?: number | null
          title?: string | null
          track_distance_metres?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_created_at?: number
          client_updated_at?: number
          created_at?: string
          device_platform?: string | null
          duration_ms?: number | null
          ended_at?: number | null
          equipment_snapshot?: Json | null
          fix_count?: number | null
          id?: string
          igc_artifact_version?: number | null
          igc_byte_count?: number | null
          igc_object_path?: string | null
          igc_sha256?: string | null
          max_gps_altitude?: number | null
          max_ground_speed?: number | null
          max_source_gap_ms?: number | null
          median_source_gap_ms?: number | null
          metrics_algorithm_version?: number | null
          metrics_computed_at?: number | null
          min_gps_altitude?: number | null
          notes?: string | null
          p95_source_gap_ms?: number | null
          quality?: Database["public"]["Enums"]["track_quality"] | null
          recorder_schema_version?: number | null
          recording_session_id?: string
          site?: string | null
          site_source?: string | null
          started_at?: number
          status?: Database["public"]["Enums"]["flight_status"]
          timezone_offset_minutes?: number | null
          title?: string | null
          track_distance_metres?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      private_equipment: {
        Row: {
          entity_key: string
          kind: string
          owner_id: string
          payload: Json
          revision: number
          updated_at: string
        }
        Insert: {
          entity_key: string
          kind: string
          owner_id: string
          payload: Json
          revision: number
          updated_at?: string
        }
        Update: {
          entity_key?: string
          kind?: string
          owner_id?: string
          payload?: Json
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      private_flight_deletions: {
        Row: {
          deleted_at: string
          flight_id: string
          recording_session_id: string | null
          storage_cleaned_at: string | null
          storage_cleanup_attempts: number
          storage_cleanup_last_error: string | null
          storage_cleanup_pending: boolean
          storage_object_path: string
          user_id: string
        }
        Insert: {
          deleted_at?: string
          flight_id: string
          recording_session_id?: string | null
          storage_cleaned_at?: string | null
          storage_cleanup_attempts?: number
          storage_cleanup_last_error?: string | null
          storage_cleanup_pending?: boolean
          storage_object_path: string
          user_id: string
        }
        Update: {
          deleted_at?: string
          flight_id?: string
          recording_session_id?: string | null
          storage_cleaned_at?: string | null
          storage_cleanup_attempts?: number
          storage_cleanup_last_error?: string | null
          storage_cleanup_pending?: boolean
          storage_object_path?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          client_updated_at: number
          created_at: string
          glider_id: string | null
          glider_type: string | null
          id: string
          pilot_name: string | null
          registration_id: string | null
          updated_at: string
        }
        Insert: {
          client_updated_at?: number
          created_at?: string
          glider_id?: string | null
          glider_type?: string | null
          id: string
          pilot_name?: string | null
          registration_id?: string | null
          updated_at?: string
        }
        Update: {
          client_updated_at?: number
          created_at?: string
          glider_id?: string | null
          glider_type?: string | null
          id?: string
          pilot_name?: string | null
          registration_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      social_profiles: {
        Row: {
          created_at: string
          discoverable: boolean
          display_name: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          discoverable?: boolean
          display_name: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          discoverable?: boolean
          display_name?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_private_flight_cleanup: {
        Args: { p_error?: string; p_flight_id: string }
        Returns: {
          deleted_at: string
          flight_id: string
          recording_session_id: string | null
          storage_cleaned_at: string | null
          storage_cleanup_attempts: number
          storage_cleanup_last_error: string | null
          storage_cleanup_pending: boolean
          storage_object_path: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "private_flight_deletions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_private_flight: {
        Args: { p_flight_id: string }
        Returns: {
          deleted_at: string
          flight_id: string
          recording_session_id: string | null
          storage_cleaned_at: string | null
          storage_cleanup_attempts: number
          storage_cleanup_last_error: string | null
          storage_cleanup_pending: boolean
          storage_object_path: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "private_flight_deletions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      read_private_equipment: { Args: never; Returns: Json }
      social_ack_artifact_cleanup: {
        Args: { p_object_path: string; p_removed: boolean }
        Returns: undefined
      }
      social_activate_upload: {
        Args: {
          p_activity_id: string
          p_byte_count: number
          p_owner: string
          p_provenance: string
          p_replay_available: boolean
          p_route_preview: Json
          p_sha256: string
          p_upload_token: string
        }
        Returns: Json
      }
      social_authorize_artifact: {
        Args: { p_activity_id: string; p_caller: string; p_generation: string }
        Returns: Json
      }
      social_begin_account_deletion: {
        Args: { p_owner: string }
        Returns: boolean
      }
      social_begin_upload: {
        Args: { p_activity_id: string; p_owner: string; p_upload_token: string }
        Returns: Json
      }
      social_block_pilot: { Args: { p_user_id: string }; Returns: undefined }
      social_change_relationship: {
        Args: {
          p_action: string
          p_other_user_id: string
          p_request_id?: string
        }
        Returns: undefined
      }
      social_finish_failed_upload: {
        Args: { p_activity_id: string; p_owner: string; p_upload_token: string }
        Returns: undefined
      }
      social_get_activity: { Args: { p_activity_id: string }; Returns: Json }
      social_get_friend_profile: { Args: { p_user_id: string }; Returns: Json }
      social_get_my_publication: {
        Args: { p_flight_id: string }
        Returns: Json
      }
      social_get_sharing_preferences: { Args: never; Returns: Json }
      social_get_state: { Args: never; Returns: Json }
      social_hide_flight: { Args: { p_flight_id: string }; Returns: Json }
      social_list_artifact_cleanup: {
        Args: { p_limit?: number }
        Returns: Json
      }
      social_list_feed: {
        Args: {
          p_cursor_activity_id?: string
          p_cursor_published_at?: string
          p_limit?: number
        }
        Returns: Json
      }
      social_list_kudos: {
        Args: {
          p_activity_id: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      social_prepare_share: {
        Args: {
          p_consent_generation: string
          p_expected_revision: number
          p_flight_id: string
          p_mode: string
          p_operation_id: string
        }
        Returns: Json
      }
      social_request_pilot: { Args: { p_user_id: string }; Returns: Json }
      social_save_profile: {
        Args: {
          p_discoverable: boolean
          p_display_name: string
          p_username: string
        }
        Returns: undefined
      }
      social_search_pilots: {
        Args: { p_cursor?: Json; p_query: string }
        Returns: Json
      }
      social_set_auto_share: { Args: { p_enabled: boolean }; Returns: Json }
      social_set_kudos: {
        Args: { p_activity_id: string; p_given: boolean }
        Returns: Json
      }
      write_private_equipment: {
        Args: {
          p_expected_revision: number
          p_key: string
          p_kind: string
          p_operation_id: string
          p_payload: Json
        }
        Returns: Json
      }
      write_private_flight: {
        Args: { p_flight: Json; p_metadata_only?: boolean }
        Returns: {
          client_created_at: number
          client_updated_at: number
          created_at: string
          device_platform: string | null
          duration_ms: number | null
          ended_at: number | null
          equipment_snapshot: Json | null
          fix_count: number | null
          id: string
          igc_artifact_version: number | null
          igc_byte_count: number | null
          igc_object_path: string | null
          igc_sha256: string | null
          max_gps_altitude: number | null
          max_ground_speed: number | null
          max_source_gap_ms: number | null
          median_source_gap_ms: number | null
          metrics_algorithm_version: number | null
          metrics_computed_at: number | null
          min_gps_altitude: number | null
          notes: string | null
          p95_source_gap_ms: number | null
          quality: Database["public"]["Enums"]["track_quality"] | null
          recorder_schema_version: number | null
          recording_session_id: string
          site: string | null
          site_source: string | null
          started_at: number
          status: Database["public"]["Enums"]["flight_status"]
          timezone_offset_minutes: number | null
          title: string | null
          track_distance_metres: number | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "flights"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      flight_status: "recording" | "processing" | "completed" | "partial"
      track_quality: "healthy" | "gaps" | "partial" | "no_track"
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
  public: {
    Enums: {
      flight_status: ["recording", "processing", "completed", "partial"],
      track_quality: ["healthy", "gaps", "partial", "no_track"],
    },
  },
} as const
