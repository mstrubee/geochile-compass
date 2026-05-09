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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      isochrone_folders: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "isochrone_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "isochrone_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_address_aliases: {
        Row: {
          created_at: string
          id: string
          normalized_address: string
          poi_id: string
          raw_address: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          normalized_address: string
          poi_id: string
          raw_address?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          normalized_address?: string
          poi_id?: string
          raw_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_address_aliases_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_attributes: {
        Row: {
          attr_key: string
          attr_value: string | null
          poi_id: string
          source_import_id: string | null
          updated_at: string
        }
        Insert: {
          attr_key: string
          attr_value?: string | null
          poi_id: string
          source_import_id?: string | null
          updated_at?: string
        }
        Update: {
          attr_key?: string
          attr_value?: string | null
          poi_id?: string
          source_import_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_attributes_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_folder_schemas: {
        Row: {
          created_at: string
          folder_id: string
          identity_columns: Json
          import_enabled: boolean
          metric_definitions: Json
          schema_type: string
          static_columns: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          folder_id: string
          identity_columns?: Json
          import_enabled?: boolean
          metric_definitions?: Json
          schema_type?: string
          static_columns?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          folder_id?: string
          identity_columns?: Json
          import_enabled?: boolean
          metric_definitions?: Json
          schema_type?: string
          static_columns?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_folder_schemas_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: true
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_folders: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          filename: string
          folder_id: string
          id: string
          metric_keys: Json
          period_max: string | null
          period_min: string | null
          rows_matched_auto: number
          rows_matched_manual: number
          rows_total: number
          rows_unmatched: number
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          filename: string
          folder_id: string
          id?: string
          metric_keys?: Json
          period_max?: string | null
          period_min?: string | null
          rows_matched_auto?: number
          rows_matched_manual?: number
          rows_total?: number
          rows_unmatched?: number
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          filename?: string
          folder_id?: string
          id?: string
          metric_keys?: Json
          period_max?: string | null
          period_min?: string | null
          rows_matched_auto?: number
          rows_matched_manual?: number
          rows_total?: number
          rows_unmatched?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_import_jobs_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_metrics: {
        Row: {
          created_at: string
          id: string
          metric_key: string
          period: string
          poi_id: string
          source_import_id: string | null
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          metric_key: string
          period: string
          poi_id: string
          source_import_id?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          metric_key?: string
          period?: string
          poi_id?: string
          source_import_id?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "poi_metrics_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
      pois: {
        Row: {
          category: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          icon: string | null
          id: string
          lat: number
          lng: number
          name: string
          properties: Json
          source_layer: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          lat: number
          lng: number
          name: string
          properties?: Json
          source_layer?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string
          lat?: number
          lng?: number
          name?: string
          properties?: Json
          source_layer?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pois_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_isochrones: {
        Row: {
          center_lat: number
          center_lng: number
          color: string | null
          created_at: string
          deleted_at: string | null
          features: Json
          folder_id: string | null
          id: string
          minutes: number[]
          mode: string
          name: string
          notes: string | null
          source_lat: number | null
          source_lng: number | null
          source_poi_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          center_lat: number
          center_lng: number
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          features: Json
          folder_id?: string | null
          id?: string
          minutes?: number[]
          mode: string
          name: string
          notes?: string | null
          source_lat?: number | null
          source_lng?: number | null
          source_poi_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          center_lat?: number
          center_lng?: number
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          features?: Json
          folder_id?: string | null
          id?: string
          minutes?: number[]
          mode?: string
          name?: string
          notes?: string | null
          source_lat?: number | null
          source_lng?: number | null
          source_poi_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_isochrones_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "isochrone_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      territorial_features: {
        Row: {
          created_at: string
          external_id: string | null
          geometry: Json
          id: string
          lat: number | null
          layer_id: string
          lng: number | null
          name: string | null
          properties: Json
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          geometry: Json
          id?: string
          lat?: number | null
          layer_id: string
          lng?: number | null
          name?: string | null
          properties?: Json
        }
        Update: {
          created_at?: string
          external_id?: string | null
          geometry?: Json
          id?: string
          lat?: number | null
          layer_id?: string
          lng?: number | null
          name?: string | null
          properties?: Json
        }
        Relationships: [
          {
            foreignKeyName: "territorial_features_layer_id_fkey"
            columns: ["layer_id"]
            isOneToOne: false
            referencedRelation: "territorial_layers"
            referencedColumns: ["id"]
          },
        ]
      }
      territorial_layer_groups: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          order_index: number
          slug: string
          updated_at: string
          visible_default: boolean
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          order_index?: number
          slug: string
          updated_at?: string
          visible_default?: boolean
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          order_index?: number
          slug?: string
          updated_at?: string
          visible_default?: boolean
        }
        Relationships: []
      }
      territorial_layers: {
        Row: {
          bbox: Json | null
          color: string | null
          created_at: string
          feature_count: number
          group_id: string
          icon: string | null
          id: string
          name: string
          order_index: number
          source_file_id: string | null
          updated_at: string
        }
        Insert: {
          bbox?: Json | null
          color?: string | null
          created_at?: string
          feature_count?: number
          group_id: string
          icon?: string | null
          id?: string
          name: string
          order_index?: number
          source_file_id?: string | null
          updated_at?: string
        }
        Update: {
          bbox?: Json | null
          color?: string | null
          created_at?: string
          feature_count?: number
          group_id?: string
          icon?: string | null
          id?: string
          name?: string
          order_index?: number
          source_file_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "territorial_layers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "territorial_layer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      territorial_source_files: {
        Row: {
          dedup_strategy: string
          error: string | null
          excluded_layers: Json
          file_type: string
          gdrive_file_id: string | null
          group_id: string | null
          id: string
          layers_summary: Json | null
          original_filename: string
          processed_at: string | null
          size_bytes: number | null
          status: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          dedup_strategy?: string
          error?: string | null
          excluded_layers?: Json
          file_type?: string
          gdrive_file_id?: string | null
          group_id?: string | null
          id?: string
          layers_summary?: Json | null
          original_filename: string
          processed_at?: string | null
          size_bytes?: number | null
          status?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          dedup_strategy?: string
          error?: string | null
          excluded_layers?: Json
          file_type?: string
          gdrive_file_id?: string | null
          group_id?: string | null
          id?: string
          layers_summary?: Json | null
          original_filename?: string
          processed_at?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "territorial_source_files_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "territorial_layer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      poi_metrics_latest: {
        Row: {
          metric_key: string | null
          period: string | null
          poi_id: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_metrics_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_deleted_pois: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
