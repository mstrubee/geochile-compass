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
      agroplanet_competitors: {
        Row: {
          categoria: string
          created_at: string | null
          cut: string | null
          direccion: string | null
          fuente: string
          id: string
          lat: number
          lng: number
          marca: string | null
          nombre: string
          region: string | null
          telefono: string | null
          url: string | null
          verified: boolean
        }
        Insert: {
          categoria: string
          created_at?: string | null
          cut?: string | null
          direccion?: string | null
          fuente?: string
          id?: string
          lat: number
          lng: number
          marca?: string | null
          nombre: string
          region?: string | null
          telefono?: string | null
          url?: string | null
          verified?: boolean
        }
        Update: {
          categoria?: string
          created_at?: string | null
          cut?: string | null
          direccion?: string | null
          fuente?: string
          id?: string
          lat?: number
          lng?: number
          marca?: string | null
          nombre?: string
          region?: string | null
          telefono?: string | null
          url?: string | null
          verified?: boolean
        }
        Relationships: []
      }
      agroplanet_comunas: {
        Row: {
          codigo_tipologia: string | null
          computed_at: string | null
          cut: string
          dist_nearest_competitor: number | null
          diversidad_especies: number | null
          ha_cereales_total: number | null
          ha_forestal_total: number | null
          ha_forrajeras_total: number | null
          ha_frutales_riego: number | null
          ha_frutales_total: number | null
          ha_vinas_riego: number | null
          ha_vinas_total: number | null
          indice_mecanizable: number | null
          macrozona: string | null
          model_version: string | null
          nearest_competitor: string | null
          nombre: string
          oportunidad_norm: number | null
          oportunidad_score: number | null
          quintil_combined: number | null
          quintil_grandes: number | null
          quintil_indap: number | null
          region: string | null
          region_id: string | null
          score_combined: number | null
          score_grandes: number | null
          score_indap: number | null
          tipologia: string | null
          total_explotaciones: number | null
          tractores_total: number | null
        }
        Insert: {
          codigo_tipologia?: string | null
          computed_at?: string | null
          cut: string
          dist_nearest_competitor?: number | null
          diversidad_especies?: number | null
          ha_cereales_total?: number | null
          ha_forestal_total?: number | null
          ha_forrajeras_total?: number | null
          ha_frutales_riego?: number | null
          ha_frutales_total?: number | null
          ha_vinas_riego?: number | null
          ha_vinas_total?: number | null
          indice_mecanizable?: number | null
          macrozona?: string | null
          model_version?: string | null
          nearest_competitor?: string | null
          nombre: string
          oportunidad_norm?: number | null
          oportunidad_score?: number | null
          quintil_combined?: number | null
          quintil_grandes?: number | null
          quintil_indap?: number | null
          region?: string | null
          region_id?: string | null
          score_combined?: number | null
          score_grandes?: number | null
          score_indap?: number | null
          tipologia?: string | null
          total_explotaciones?: number | null
          tractores_total?: number | null
        }
        Update: {
          codigo_tipologia?: string | null
          computed_at?: string | null
          cut?: string
          dist_nearest_competitor?: number | null
          diversidad_especies?: number | null
          ha_cereales_total?: number | null
          ha_forestal_total?: number | null
          ha_forrajeras_total?: number | null
          ha_frutales_riego?: number | null
          ha_frutales_total?: number | null
          ha_vinas_riego?: number | null
          ha_vinas_total?: number | null
          indice_mecanizable?: number | null
          macrozona?: string | null
          model_version?: string | null
          nearest_competitor?: string | null
          nombre?: string
          oportunidad_norm?: number | null
          oportunidad_score?: number | null
          quintil_combined?: number | null
          quintil_grandes?: number | null
          quintil_indap?: number | null
          region?: string | null
          region_id?: string | null
          score_combined?: number | null
          score_grandes?: number | null
          score_indap?: number | null
          tipologia?: string | null
          total_explotaciones?: number | null
          tractores_total?: number | null
        }
        Relationships: []
      }
      agroplanet_model_config: {
        Row: {
          active: boolean
          created_at: string | null
          id: number
          notas: string | null
          peso_grandes: number
          peso_indap: number
          variable: string
          version: string
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          id?: number
          notas?: string | null
          peso_grandes: number
          peso_indap: number
          variable: string
          version?: string
        }
        Update: {
          active?: boolean
          created_at?: string | null
          id?: number
          notas?: string | null
          peso_grandes?: number
          peso_indap?: number
          variable?: string
          version?: string
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
      brand_catalog: {
        Row: {
          activo: boolean | null
          categoria: string
          color_hex: string | null
          created_at: string | null
          icon_emoji: string | null
          id: number
          logo_url: string | null
          marca_estandar: string
          raw_name: string
          subcategoria: string | null
        }
        Insert: {
          activo?: boolean | null
          categoria: string
          color_hex?: string | null
          created_at?: string | null
          icon_emoji?: string | null
          id?: number
          logo_url?: string | null
          marca_estandar: string
          raw_name: string
          subcategoria?: string | null
        }
        Update: {
          activo?: boolean | null
          categoria?: string
          color_hex?: string | null
          created_at?: string | null
          icon_emoji?: string | null
          id?: number
          logo_url?: string | null
          marca_estandar?: string
          raw_name?: string
          subcategoria?: string | null
        }
        Relationships: []
      }
      comercial_categorias: {
        Row: {
          activo: boolean
          color_hex: string
          created_at: string | null
          icon_emoji: string
          id: number
          key: string
          label_es: string
          osm_tags: Json | null
          sort_order: number
        }
        Insert: {
          activo?: boolean
          color_hex?: string
          created_at?: string | null
          icon_emoji?: string
          id?: number
          key: string
          label_es: string
          osm_tags?: Json | null
          sort_order?: number
        }
        Update: {
          activo?: boolean
          color_hex?: string
          created_at?: string | null
          icon_emoji?: string
          id?: number
          key?: string
          label_es?: string
          osm_tags?: Json | null
          sort_order?: number
        }
        Relationships: []
      }
      comercio_poi: {
        Row: {
          cadena: string | null
          categoria: string
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string
          osm_type: string
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria: string
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id: string
          osm_type: string
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string
          osm_type?: string
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      comercio_poi_sync_log: {
        Row: {
          error: string | null
          id: number
          registros_actualizados: number | null
          registros_eliminados: number | null
          registros_nuevos: number | null
          registros_sin_cambio: number | null
          status: string | null
          sync_end: string | null
          sync_start: string | null
          total_osm_features: number | null
        }
        Insert: {
          error?: string | null
          id?: number
          registros_actualizados?: number | null
          registros_eliminados?: number | null
          registros_nuevos?: number | null
          registros_sin_cambio?: number | null
          status?: string | null
          sync_end?: string | null
          sync_start?: string | null
          total_osm_features?: number | null
        }
        Update: {
          error?: string | null
          id?: number
          registros_actualizados?: number | null
          registros_eliminados?: number | null
          registros_nuevos?: number | null
          registros_sin_cambio?: number | null
          status?: string | null
          sync_end?: string | null
          sync_start?: string | null
          total_osm_features?: number | null
        }
        Relationships: []
      }
      commune_coord_overrides: {
        Row: {
          created_at: string
          lat: number
          lng: number
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          lat: number
          lng: number
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          lat?: number
          lng?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
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
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
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
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
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
      v_bancos: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_centros_comerciales: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_combustibles: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_conveniencias: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_farmacias: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_mejoramiento_hogar: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_restaurantes: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_resumen_comercial: {
        Row: {
          categoria: string | null
          marca_estandar: string | null
          region: string | null
          total_locales: number | null
        }
        Relationships: []
      }
      v_retail: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
      v_supermercados: {
        Row: {
          cadena: string | null
          categoria: string | null
          codigo_region: string | null
          comuna: string | null
          direccion: string | null
          eliminado: boolean | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          fecha_eliminacion: string | null
          fuente: string | null
          geom: unknown
          id: number | null
          latitud: number | null
          longitud: number | null
          marca: string | null
          marca_estandar: string | null
          nombre: string | null
          osm_id: string | null
          osm_type: string | null
          osm_version: number | null
          region: string | null
          subcategoria: string | null
          tags: Json | null
        }
        Insert: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Update: {
          cadena?: string | null
          categoria?: string | null
          codigo_region?: string | null
          comuna?: string | null
          direccion?: string | null
          eliminado?: boolean | null
          fecha_actualizacion?: string | null
          fecha_creacion?: string | null
          fecha_eliminacion?: string | null
          fuente?: string | null
          geom?: unknown
          id?: number | null
          latitud?: number | null
          longitud?: number | null
          marca?: string | null
          marca_estandar?: string | null
          nombre?: string | null
          osm_id?: string | null
          osm_type?: string | null
          osm_version?: number | null
          region?: string | null
          subcategoria?: string | null
          tags?: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          is_admin: boolean
          user_id: string
        }[]
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      fn_participacion_marcas: {
        Args: { p_categoria: string }
        Returns: {
          marca_estandar: string
          total_locales: number
        }[]
      }
      fn_pois_cercanos: {
        Args: {
          p_categoria?: string
          p_lat: number
          p_limite?: number
          p_lng: number
          p_marca?: string
          p_radio_m?: number
        }
        Returns: {
          categoria: string
          comuna: string
          direccion: string
          distancia_m: number
          id: number
          latitud: number
          longitud: number
          marca_estandar: string
          nombre: string
        }[]
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
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
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      purge_deleted_pois: { Args: never; Returns: undefined }
      set_poi_folder_kpi_order: {
        Args: { _folder_id: string; _order: Json }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      territorial_role_default_weight: {
        Args: { role_name: string }
        Returns: number
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      user_section_permissions: { Args: { _user_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
