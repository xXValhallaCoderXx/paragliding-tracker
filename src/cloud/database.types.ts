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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
