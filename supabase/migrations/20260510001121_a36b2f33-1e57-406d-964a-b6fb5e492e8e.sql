DELETE FROM poi_features_cache;
UPDATE analysis_settings SET config_version = config_version + 1, updated_at = NOW();