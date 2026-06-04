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
      _migration_log: {
        Row: {
          applied_at: string
          id: number
          notes: string | null
          sprint: string | null
        }
        Insert: {
          applied_at?: string
          id?: number
          notes?: string | null
          sprint?: string | null
        }
        Update: {
          applied_at?: string
          id?: number
          notes?: string | null
          sprint?: string | null
        }
        Relationships: []
      }
      _poi_features_cache_pre_migration_backup: {
        Row: {
          computed_at: string | null
          config_version: number | null
          features: Json | null
          folder_id: string | null
          is_rm: boolean | null
          iso_geom_hash: string | null
          iso_minutes: number | null
          poi_id: string | null
        }
        Insert: {
          computed_at?: string | null
          config_version?: number | null
          features?: Json | null
          folder_id?: string | null
          is_rm?: boolean | null
          iso_geom_hash?: string | null
          iso_minutes?: number | null
          poi_id?: string | null
        }
        Update: {
          computed_at?: string | null
          config_version?: number | null
          features?: Json | null
          folder_id?: string | null
          is_rm?: boolean | null
          iso_geom_hash?: string | null
          iso_minutes?: number | null
          poi_id?: string | null
        }
        Relationships: []
      }
      _poi_features_cache_pre_tarea3: {
        Row: {
          computed_at: string | null
          config_version: number | null
          features: Json | null
          folder_id: string | null
          is_rm: boolean | null
          iso_geom_hash: string | null
          iso_minutes: number | null
          poi_id: string | null
          snapshot_at: string | null
        }
        Insert: {
          computed_at?: string | null
          config_version?: number | null
          features?: Json | null
          folder_id?: string | null
          is_rm?: boolean | null
          iso_geom_hash?: string | null
          iso_minutes?: number | null
          poi_id?: string | null
          snapshot_at?: string | null
        }
        Update: {
          computed_at?: string | null
          config_version?: number | null
          features?: Json | null
          folder_id?: string | null
          is_rm?: boolean | null
          iso_geom_hash?: string | null
          iso_minutes?: number | null
          poi_id?: string | null
          snapshot_at?: string | null
        }
        Relationships: []
      }
      _poi_folders_pre_migration_backup: {
        Row: {
          color: string | null
          created_at: string | null
          deleted_at: string | null
          id: string | null
          name: string | null
          parent_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string | null
          name?: string | null
          parent_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string | null
          name?: string | null
          parent_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _poi_metrics_synthetic_backup_20260517: {
        Row: {
          created_at: string | null
          id: string | null
          metric_key: string | null
          period: string | null
          poi_id: string | null
          source_import_id: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          metric_key?: string | null
          period?: string | null
          poi_id?: string | null
          source_import_id?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          metric_key?: string | null
          period?: string | null
          poi_id?: string | null
          source_import_id?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: []
      }
      _pois_pre_migration_backup: {
        Row: {
          category: string | null
          color: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          icon: string | null
          id: string | null
          lat: number | null
          lng: number | null
          name: string | null
          properties: Json | null
          source_layer: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          properties?: Json | null
          source_layer?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          icon?: string | null
          id?: string | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          properties?: Json | null
          source_layer?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _r2_baseline_pre_tarea3: {
        Row: {
          computed_at: string | null
          config_version: number | null
          folder_id: string | null
          folder_name: string | null
          model_a_r2: number | null
          model_b_r2: number | null
          poi_id: string | null
          snapshot_at: string | null
          snapshot_label: string | null
        }
        Insert: {
          computed_at?: string | null
          config_version?: number | null
          folder_id?: string | null
          folder_name?: string | null
          model_a_r2?: number | null
          model_b_r2?: number | null
          poi_id?: string | null
          snapshot_at?: string | null
          snapshot_label?: string | null
        }
        Update: {
          computed_at?: string | null
          config_version?: number | null
          folder_id?: string | null
          folder_name?: string | null
          model_a_r2?: number | null
          model_b_r2?: number | null
          poi_id?: string | null
          snapshot_at?: string | null
          snapshot_label?: string | null
        }
        Relationships: []
      }
      _territorial_features_reasignacion_backup_20260517: {
        Row: {
          created_at: string | null
          external_id: string | null
          geometry: Json | null
          id: string | null
          lat: number | null
          layer_id: string | null
          lng: number | null
          name: string | null
          properties: Json | null
        }
        Insert: {
          created_at?: string | null
          external_id?: string | null
          geometry?: Json | null
          id?: string | null
          lat?: number | null
          layer_id?: string | null
          lng?: number | null
          name?: string | null
          properties?: Json | null
        }
        Update: {
          created_at?: string | null
          external_id?: string | null
          geometry?: Json | null
          id?: string | null
          lat?: number | null
          layer_id?: string | null
          lng?: number | null
          name?: string | null
          properties?: Json | null
        }
        Relationships: []
      }
      analysis_settings: {
        Row: {
          config_version: number
          created_at: string
          external_competition_folder_ids: Json
          external_competition_layer_ids: Json
          folder_id: string
          iso_minutes_regions: number
          iso_minutes_rm: number
          updated_at: string
          updated_by: string | null
          use_fine_cannibalization: boolean
        }
        Insert: {
          config_version?: number
          created_at?: string
          external_competition_folder_ids?: Json
          external_competition_layer_ids?: Json
          folder_id: string
          iso_minutes_regions?: number
          iso_minutes_rm?: number
          updated_at?: string
          updated_by?: string | null
          use_fine_cannibalization?: boolean
        }
        Update: {
          config_version?: number
          created_at?: string
          external_competition_folder_ids?: Json
          external_competition_layer_ids?: Json
          folder_id?: string
          iso_minutes_regions?: number
          iso_minutes_rm?: number
          updated_at?: string
          updated_by?: string | null
          use_fine_cannibalization?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "analysis_settings_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: true
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      complement_weight_rules: {
        Row: {
          created_at: string
          enabled: boolean
          folder_id: string | null
          id: string
          label: string | null
          pattern: string
          priority: number
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          folder_id?: string | null
          id?: string
          label?: string | null
          pattern: string
          priority?: number
          updated_at?: string
          weight: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          folder_id?: string | null
          id?: string
          label?: string | null
          pattern?: string
          priority?: number
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "complement_weight_rules_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      evaluation_dimensions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          title: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          title: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          title?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      folder_layer_roles: {
        Row: {
          created_at: string
          created_by: string | null
          folder_id: string
          group_id: string | null
          id: string
          layer_id: string | null
          role: string
          updated_at: string
          weight_override: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          folder_id: string
          group_id?: string | null
          id?: string
          layer_id?: string | null
          role: string
          updated_at?: string
          weight_override?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          folder_id?: string
          group_id?: string | null
          id?: string
          layer_id?: string | null
          role?: string
          updated_at?: string
          weight_override?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "folder_layer_roles_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folder_layer_roles_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "territorial_layer_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folder_layer_roles_layer_id_fkey"
            columns: ["layer_id"]
            isOneToOne: false
            referencedRelation: "territorial_layers"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_api_keys: {
        Row: {
          alias: string
          api_key: string
          created_at: string
          enabled: boolean
          error_count: number
          id: string
          last_error_at: string | null
          last_error_message: string | null
          last_error_reason: string | null
          last_used_at: string | null
          priority: number
          success_count: number
          updated_at: string
        }
        Insert: {
          alias: string
          api_key: string
          created_at?: string
          enabled?: boolean
          error_count?: number
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_error_reason?: string | null
          last_used_at?: string | null
          priority?: number
          success_count?: number
          updated_at?: string
        }
        Update: {
          alias?: string
          api_key?: string
          created_at?: string
          enabled?: boolean
          error_count?: number
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          last_error_reason?: string | null
          last_used_at?: string | null
          priority?: number
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      gemini_key_links: {
        Row: {
          created_at: string
          id: string
          label: string
          order_index: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          order_index?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          order_index?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      heatmap_layer_settings: {
        Row: {
          blur: number
          layer_key: string
          min_zoom: number
          opacity: number
          radius: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          blur?: number
          layer_key: string
          min_zoom?: number
          opacity?: number
          radius?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          blur?: number
          layer_key?: string
          min_zoom?: number
          opacity?: number
          radius?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
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
      poi_evaluations: {
        Row: {
          created_at: string
          dimension_id: string
          evaluator_id: string | null
          id: string
          notes: string | null
          poi_id: string
          score: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          dimension_id: string
          evaluator_id?: string | null
          id?: string
          notes?: string | null
          poi_id: string
          score: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          dimension_id?: string
          evaluator_id?: string | null
          id?: string
          notes?: string | null
          poi_id?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_evaluations_dimension_id_fkey"
            columns: ["dimension_id"]
            isOneToOne: false
            referencedRelation: "evaluation_dimensions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_evaluations_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_features_cache: {
        Row: {
          computed_at: string
          config_version: number
          features: Json
          folder_id: string
          is_rm: boolean
          iso_geom_hash: string | null
          iso_minutes: number
          poi_id: string
        }
        Insert: {
          computed_at?: string
          config_version: number
          features: Json
          folder_id: string
          is_rm: boolean
          iso_geom_hash?: string | null
          iso_minutes: number
          poi_id: string
        }
        Update: {
          computed_at?: string
          config_version?: number
          features?: Json
          folder_id?: string
          is_rm?: boolean
          iso_geom_hash?: string | null
          iso_minutes?: number
          poi_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_features_cache_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_features_cache_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: true
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
          kpi_order: Json
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
          kpi_order?: Json
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
          kpi_order?: Json
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
      poi_import_identity_memory: {
        Row: {
          created_at: string
          folder_id: string
          id: string
          key_type: string
          key_value: string
          poi_id: string
        }
        Insert: {
          created_at?: string
          folder_id: string
          id?: string
          key_type: string
          key_value: string
          poi_id: string
        }
        Update: {
          created_at?: string
          folder_id?: string
          id?: string
          key_type?: string
          key_value?: string
          poi_id?: string
        }
        Relationships: []
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
          source_file_path: string | null
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
          source_file_path?: string | null
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
          source_file_path?: string | null
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
      poi_import_skip_memory: {
        Row: {
          created_at: string
          folder_id: string
          id: string
          normalized_key: string
          raw_address: string | null
          raw_name: string | null
        }
        Insert: {
          created_at?: string
          folder_id: string
          id?: string
          normalized_key: string
          raw_address?: string | null
          raw_name?: string | null
        }
        Update: {
          created_at?: string
          folder_id?: string
          id?: string
          normalized_key?: string
          raw_address?: string | null
          raw_name?: string | null
        }
        Relationships: []
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
      poi_performance_analysis: {
        Row: {
          actual_monthly_clp: number | null
          actual_monthly_uf: number | null
          computed_at: string
          config_version: number
          folder_id: string
          interpretation: string | null
          model_a_features_used: Json | null
          model_a_r2: number | null
          model_b_features_used: Json | null
          model_b_n_evaluated: number | null
          model_b_r2: number | null
          peer_poi_ids: string[]
          poi_id: string
          predicted_monthly_clp: number | null
          predicted_monthly_uf: number | null
          predicted_monthly_uf_model_a: number | null
          predicted_monthly_uf_model_b: number | null
          residual_clp: number | null
          residual_pct: number | null
          residual_pct_model_a: number | null
          residual_pct_model_b: number | null
          residual_uf_model_a: number | null
          residual_uf_model_b: number | null
          target_year: number
          temporal_decomposition: Json
          temporal_state: string | null
          top_drivers: Json
        }
        Insert: {
          actual_monthly_clp?: number | null
          actual_monthly_uf?: number | null
          computed_at?: string
          config_version: number
          folder_id: string
          interpretation?: string | null
          model_a_features_used?: Json | null
          model_a_r2?: number | null
          model_b_features_used?: Json | null
          model_b_n_evaluated?: number | null
          model_b_r2?: number | null
          peer_poi_ids?: string[]
          poi_id: string
          predicted_monthly_clp?: number | null
          predicted_monthly_uf?: number | null
          predicted_monthly_uf_model_a?: number | null
          predicted_monthly_uf_model_b?: number | null
          residual_clp?: number | null
          residual_pct?: number | null
          residual_pct_model_a?: number | null
          residual_pct_model_b?: number | null
          residual_uf_model_a?: number | null
          residual_uf_model_b?: number | null
          target_year: number
          temporal_decomposition?: Json
          temporal_state?: string | null
          top_drivers?: Json
        }
        Update: {
          actual_monthly_clp?: number | null
          actual_monthly_uf?: number | null
          computed_at?: string
          config_version?: number
          folder_id?: string
          interpretation?: string | null
          model_a_features_used?: Json | null
          model_a_r2?: number | null
          model_b_features_used?: Json | null
          model_b_n_evaluated?: number | null
          model_b_r2?: number | null
          peer_poi_ids?: string[]
          poi_id?: string
          predicted_monthly_clp?: number | null
          predicted_monthly_uf?: number | null
          predicted_monthly_uf_model_a?: number | null
          predicted_monthly_uf_model_b?: number | null
          residual_clp?: number | null
          residual_pct?: number | null
          residual_pct_model_a?: number | null
          residual_pct_model_b?: number | null
          residual_uf_model_a?: number | null
          residual_uf_model_b?: number | null
          target_year?: number
          temporal_decomposition?: Json
          temporal_state?: string | null
          top_drivers?: Json
        }
        Relationships: [
          {
            foreignKeyName: "poi_performance_analysis_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "poi_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_performance_analysis_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: true
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
          heatmap_aggregate_url: string | null
          heatmap_enabled: boolean
          icon: string | null
          icon_render: string | null
          id: string
          last_dedup_strategy: string | null
          name: string
          order_index: number
          parent_layer_id: string | null
          render_mode: string
          source_file_id: string | null
          source_name: string | null
          updated_at: string
        }
        Insert: {
          bbox?: Json | null
          color?: string | null
          created_at?: string
          feature_count?: number
          group_id: string
          heatmap_aggregate_url?: string | null
          heatmap_enabled?: boolean
          icon?: string | null
          icon_render?: string | null
          id?: string
          last_dedup_strategy?: string | null
          name: string
          order_index?: number
          parent_layer_id?: string | null
          render_mode?: string
          source_file_id?: string | null
          source_name?: string | null
          updated_at?: string
        }
        Update: {
          bbox?: Json | null
          color?: string | null
          created_at?: string
          feature_count?: number
          group_id?: string
          heatmap_aggregate_url?: string | null
          heatmap_enabled?: boolean
          icon?: string | null
          icon_render?: string | null
          id?: string
          last_dedup_strategy?: string | null
          name?: string
          order_index?: number
          parent_layer_id?: string | null
          render_mode?: string
          source_file_id?: string | null
          source_name?: string | null
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
          {
            foreignKeyName: "territorial_layers_parent_layer_id_fkey"
            columns: ["parent_layer_id"]
            isOneToOne: false
            referencedRelation: "territorial_layers"
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
      uf_values: {
        Row: {
          created_at: string
          period: string
          source: string | null
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          period: string
          source?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          period?: string
          source?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      user_role_assignments: {
        Row: {
          created_at: string
          custom_role_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_role_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_role_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_assignments_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
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
      user_ui_prefs: {
        Row: {
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      poi_evaluation_summary: {
        Row: {
          breakdown: Json | null
          dimensions_evaluated: number | null
          dimensions_total_active: number | null
          last_evaluated_at: string | null
          last_evaluator_id: string | null
          poi_id: string | null
          weighted_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_evaluations_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
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
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          is_admin: boolean
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      poi_counts_by_folder: {
        Args: never
        Returns: {
          cnt: number
          folder_id: string
        }[]
      }
      poi_sync_summary: {
        Args: never
        Returns: {
          checksum: string
          max_updated_at: string
          row_count: number
        }[]
      }
      purge_deleted_pois: { Args: never; Returns: undefined }
      set_poi_folder_kpi_order: {
        Args: { _folder_id: string; _order: Json }
        Returns: undefined
      }
      territorial_role_default_weight: {
        Args: { role_name: string }
        Returns: number
      }
      user_section_permissions: { Args: { _user_id: string }; Returns: Json }
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
