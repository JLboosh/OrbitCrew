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
      badges: {
        Row: {
          created_at: string
          description: string | null
          emoji: string | null
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          emoji?: string | null
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          emoji?: string | null
          key?: string
          name?: string
        }
        Relationships: []
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          completed_at: string | null
          joined_at: string
          last_scored_at: string | null
          progress: number
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          joined_at?: string
          last_scored_at?: string | null
          progress?: number
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          joined_at?: string
          last_scored_at?: string | null
          progress?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_templates: {
        Row: {
          badge_emoji: string | null
          badge_key: string | null
          created_at: string
          default_duration_days: number
          default_rule: Json
          default_scope: Database["public"]["Enums"]["challenge_scope"]
          description: string
          key: string
          name: string
          rule_type: Database["public"]["Enums"]["challenge_rule_type"]
        }
        Insert: {
          badge_emoji?: string | null
          badge_key?: string | null
          created_at?: string
          default_duration_days?: number
          default_rule?: Json
          default_scope?: Database["public"]["Enums"]["challenge_scope"]
          description: string
          key: string
          name: string
          rule_type: Database["public"]["Enums"]["challenge_rule_type"]
        }
        Update: {
          badge_emoji?: string | null
          badge_key?: string | null
          created_at?: string
          default_duration_days?: number
          default_rule?: Json
          default_scope?: Database["public"]["Enums"]["challenge_scope"]
          description?: string
          key?: string
          name?: string
          rule_type?: Database["public"]["Enums"]["challenge_rule_type"]
        }
        Relationships: []
      }
      challenges: {
        Row: {
          badge_emoji: string | null
          badge_key: string | null
          created_at: string
          created_by: string | null
          crew_id: string | null
          description: string | null
          ends_at: string
          id: string
          name: string
          owner_id: string | null
          rule: Json
          rule_type: Database["public"]["Enums"]["challenge_rule_type"]
          scope: Database["public"]["Enums"]["challenge_scope"]
          starts_at: string
          target: number
          template_key: string | null
          timezone: string
          updated_at: string
          visibility: Database["public"]["Enums"]["challenge_visibility"]
        }
        Insert: {
          badge_emoji?: string | null
          badge_key?: string | null
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          description?: string | null
          ends_at: string
          id?: string
          name: string
          owner_id?: string | null
          rule?: Json
          rule_type: Database["public"]["Enums"]["challenge_rule_type"]
          scope: Database["public"]["Enums"]["challenge_scope"]
          starts_at: string
          target: number
          template_key?: string | null
          timezone?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["challenge_visibility"]
        }
        Update: {
          badge_emoji?: string | null
          badge_key?: string | null
          created_at?: string
          created_by?: string | null
          crew_id?: string | null
          description?: string | null
          ends_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          rule?: Json
          rule_type?: Database["public"]["Enums"]["challenge_rule_type"]
          scope?: Database["public"]["Enums"]["challenge_scope"]
          starts_at?: string
          target?: number
          template_key?: string | null
          timezone?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["challenge_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "challenges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "challenge_templates"
            referencedColumns: ["key"]
          },
        ]
      }
      crew_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          crew_id: string
          expires_at: string
          id: string
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          crew_id: string
          expires_at: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          crew_id?: string
          expires_at?: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "crew_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_invites_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          activity_detail_override:
            | Database["public"]["Enums"]["activity_detail_level"]
            | null
          crew_id: string
          joined_at: string
          role: Database["public"]["Enums"]["crew_role"]
          share_presence: boolean
          user_id: string
        }
        Insert: {
          activity_detail_override?:
            | Database["public"]["Enums"]["activity_detail_level"]
            | null
          crew_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["crew_role"]
          share_presence?: boolean
          user_id: string
        }
        Update: {
          activity_detail_override?:
            | Database["public"]["Enums"]["activity_detail_level"]
            | null
          crew_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["crew_role"]
          share_presence?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crews: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          leaderboard_metric: Database["public"]["Enums"]["crew_leaderboard_metric"]
          min_session_minutes: number
          name: string
          spotlight_enabled: boolean
          timezone: string
          updated_at: string
          weekly_target_sessions: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          leaderboard_metric?: Database["public"]["Enums"]["crew_leaderboard_metric"]
          min_session_minutes?: number
          name: string
          spotlight_enabled?: boolean
          timezone?: string
          updated_at?: string
          weekly_target_sessions?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          leaderboard_metric?: Database["public"]["Enums"]["crew_leaderboard_metric"]
          min_session_minutes?: number
          name?: string
          spotlight_enabled?: boolean
          timezone?: string
          updated_at?: string
          weekly_target_sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "crews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_baselines: {
        Row: {
          baseline_1rm_kg: number | null
          baseline_at: string
          exercise_id: string
          user_id: string
        }
        Insert: {
          baseline_1rm_kg?: number | null
          baseline_at?: string
          exercise_id: string
          user_id: string
        }
        Update: {
          baseline_1rm_kg?: number | null
          baseline_at?: string
          exercise_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_baselines_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_baselines_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          equipment: Database["public"]["Enums"]["exercise_equipment"]
          id: string
          is_weighted: boolean
          name: string
          primary_muscle: Database["public"]["Enums"]["muscle_group"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          equipment?: Database["public"]["Enums"]["exercise_equipment"]
          id?: string
          is_weighted?: boolean
          name: string
          primary_muscle: Database["public"]["Enums"]["muscle_group"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          equipment?: Database["public"]["Enums"]["exercise_equipment"]
          id?: string
          is_weighted?: boolean
          name?: string
          primary_muscle?: Database["public"]["Enums"]["muscle_group"]
        }
        Relationships: [
          {
            foreignKeyName: "exercises_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          requested_by: string
          status: Database["public"]["Enums"]["friendship_status"]
          updated_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          requested_by: string
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_ratings: {
        Row: {
          air_conditioning: number | null
          cleanliness: number | null
          created_at: string
          crowding: number | null
          equipment_availability: number | null
          equipment_quality: number | null
          gym_id: string
          id: string
          overall: number
          review_text: string | null
          updated_at: string
          user_id: string
          value_for_money: number | null
        }
        Insert: {
          air_conditioning?: number | null
          cleanliness?: number | null
          created_at?: string
          crowding?: number | null
          equipment_availability?: number | null
          equipment_quality?: number | null
          gym_id: string
          id?: string
          overall: number
          review_text?: string | null
          updated_at?: string
          user_id: string
          value_for_money?: number | null
        }
        Update: {
          air_conditioning?: number | null
          cleanliness?: number | null
          created_at?: string
          crowding?: number | null
          equipment_availability?: number | null
          equipment_quality?: number | null
          gym_id?: string
          id?: string
          overall?: number
          review_text?: string | null
          updated_at?: string
          user_id?: string
          value_for_money?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_ratings_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gym_rating_summaries"
            referencedColumns: ["gym_id"]
          },
          {
            foreignKeyName: "gym_ratings_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_reports: {
        Row: {
          created_at: string
          detail: string | null
          gym_id: string | null
          id: string
          rating_id: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolved_at: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          gym_id?: string | null
          id?: string
          rating_id?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolved_at?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          gym_id?: string | null
          id?: string
          rating_id?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_reports_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gym_rating_summaries"
            referencedColumns: ["gym_id"]
          },
          {
            foreignKeyName: "gym_reports_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_reports_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "gym_ratings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gyms: {
        Row: {
          address: string | null
          city: string | null
          country_code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          hidden_at: string | null
          id: string
          image_url: string | null
          location: unknown
          name: string
          opening_hours: string | null
          osm_id: string | null
          phone: string | null
          source: Database["public"]["Enums"]["gym_source"]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          hidden_at?: string | null
          id?: string
          image_url?: string | null
          location: unknown
          name: string
          opening_hours?: string | null
          osm_id?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["gym_source"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          hidden_at?: string | null
          id?: string
          image_url?: string | null
          location?: unknown
          name?: string
          opening_hours?: string | null
          osm_id?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["gym_source"]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gyms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_records: {
        Row: {
          achieved_at: string
          exercise_id: string
          id: string
          record_type: Database["public"]["Enums"]["record_type"]
          session_id: string | null
          set_id: string | null
          user_id: string
          value: number
        }
        Insert: {
          achieved_at?: string
          exercise_id: string
          id?: string
          record_type: Database["public"]["Enums"]["record_type"]
          session_id?: string | null
          set_id?: string | null
          user_id: string
          value: number
        }
        Update: {
          achieved_at?: string
          exercise_id?: string
          id?: string
          record_type?: Database["public"]["Enums"]["record_type"]
          session_id?: string | null
          set_id?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "personal_records_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_records_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      presence: {
        Row: {
          expires_at: string
          gym_id: string
          session_id: string | null
          started_at: string
          user_id: string
        }
        Insert: {
          expires_at: string
          gym_id: string
          session_id?: string | null
          started_at?: string
          user_id: string
        }
        Update: {
          expires_at?: string
          gym_id?: string
          session_id?: string | null
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presence_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gym_rating_summaries"
            referencedColumns: ["gym_id"]
          },
          {
            foreignKeyName: "presence_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presence_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_settings: {
        Row: {
          allow_motivation_spotlight: boolean
          contribute_to_crowd_stats: boolean
          created_at: string
          default_activity_detail: Database["public"]["Enums"]["activity_detail_level"]
          discoverable_by_username: boolean
          presence_visibility: Database["public"]["Enums"]["presence_visibility"]
          share_progress_summary: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_motivation_spotlight?: boolean
          contribute_to_crowd_stats?: boolean
          created_at?: string
          default_activity_detail?: Database["public"]["Enums"]["activity_detail_level"]
          discoverable_by_username?: boolean
          presence_visibility?: Database["public"]["Enums"]["presence_visibility"]
          share_progress_summary?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_motivation_spotlight?: boolean
          contribute_to_crowd_stats?: boolean
          created_at?: string
          default_activity_detail?: Database["public"]["Enums"]["activity_detail_level"]
          discoverable_by_username?: boolean
          presence_visibility?: Database["public"]["Enums"]["presence_visibility"]
          share_progress_summary?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          timezone: string
          updated_at: string
          username: string
          weight_unit: Database["public"]["Enums"]["weight_unit"]
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          id: string
          timezone?: string
          updated_at?: string
          username: string
          weight_unit?: Database["public"]["Enums"]["weight_unit"]
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          timezone?: string
          updated_at?: string
          username?: string
          weight_unit?: Database["public"]["Enums"]["weight_unit"]
        }
        Relationships: []
      }
      session_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          notes: string | null
          order_index: number
          session_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          notes?: string | null
          order_index?: number
          session_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          notes?: string | null
          order_index?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          gym_id: string | null
          id: string
          notes: string | null
          started_at: string
          updated_at: string
          user_id: string
          workout_categories: string[]
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          gym_id?: string | null
          id?: string
          notes?: string | null
          started_at?: string
          updated_at?: string
          user_id: string
          workout_categories?: string[]
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          gym_id?: string | null
          id?: string
          notes?: string | null
          started_at?: string
          updated_at?: string
          user_id?: string
          workout_categories?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "sessions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gym_rating_summaries"
            referencedColumns: ["gym_id"]
          },
          {
            foreignKeyName: "sessions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sets: {
        Row: {
          created_at: string
          duration_seconds: number | null
          estimated_1rm_kg: number | null
          id: string
          is_warmup: boolean
          reps: number | null
          rpe: number | null
          session_exercise_id: string
          set_index: number
          weight: number | null
          weight_kg: number | null
          weight_unit: Database["public"]["Enums"]["weight_unit"]
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          estimated_1rm_kg?: number | null
          id?: string
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          session_exercise_id: string
          set_index?: number
          weight?: number | null
          weight_kg?: number | null
          weight_unit?: Database["public"]["Enums"]["weight_unit"]
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          estimated_1rm_kg?: number | null
          id?: string
          is_warmup?: boolean
          reps?: number | null
          rpe?: number | null
          session_exercise_id?: string
          set_index?: number
          weight?: number | null
          weight_kg?: number | null
          weight_unit?: Database["public"]["Enums"]["weight_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "sets_session_exercise_id_fkey"
            columns: ["session_exercise_id"]
            isOneToOne: false
            referencedRelation: "session_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          awarded_at: string
          badge_key: string
          challenge_id: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge_key: string
          challenge_id: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge_key?: string
          challenge_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_key_fkey"
            columns: ["badge_key"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "user_badges_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      gym_rating_summaries: {
        Row: {
          avg_air_conditioning: number | null
          avg_cleanliness: number | null
          avg_crowding: number | null
          avg_equipment_availability: number | null
          avg_equipment_quality: number | null
          avg_overall: number | null
          avg_value_for_money: number | null
          gym_id: string | null
          rating_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      are_friends: { Args: { p_one: string; p_two: string }; Returns: boolean }
      caller_crew_role: {
        Args: { p_crew_id: string }
        Returns: Database["public"]["Enums"]["crew_role"]
      }
      caller_in_crew: { Args: { p_crew_id: string }; Returns: boolean }
      caller_is_crew_admin: { Args: { p_crew_id: string }; Returns: boolean }
      can_see_presence_of: { Args: { p_target: string }; Returns: boolean }
      check_in: {
        Args: {
          p_duration_minutes?: number
          p_gym_id: string
          p_session_id?: string
        }
        Returns: {
          expires_at: string
          gym_id: string
          session_id: string | null
          started_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "presence"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_out: { Args: never; Returns: undefined }
      create_crew: {
        Args: {
          p_description?: string
          p_min_session_minutes?: number
          p_name: string
          p_timezone?: string
          p_weekly_target_sessions?: number
        }
        Returns: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          leaderboard_metric: Database["public"]["Enums"]["crew_leaderboard_metric"]
          min_session_minutes: number
          name: string
          spotlight_enabled: boolean
          timezone: string
          updated_at: string
          weekly_target_sessions: number
        }
        SetofOptions: {
          from: "*"
          to: "crews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_crew_invite: {
        Args: {
          p_crew_id: string
          p_expires_in_hours?: number
          p_max_uses?: number
        }
        Returns: {
          code: string
          created_at: string
          created_by: string | null
          crew_id: string
          expires_at: string
          id: string
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        SetofOptions: {
          from: "*"
          to: "crew_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_user_gym: {
        Args: {
          p_address?: string
          p_city?: string
          p_confirm_possible_duplicate?: boolean
          p_country_code?: string
          p_description?: string
          p_image_url?: string
          p_latitude: number
          p_longitude: number
          p_name: string
          p_website?: string
        }
        Returns: string
      }
      crew_role_of: {
        Args: { p_crew_id: string; p_user_id?: string }
        Returns: Database["public"]["Enums"]["crew_role"]
      }
      crew_weekly_leaderboard: {
        Args: { p_crew_id: string; p_week_offset?: number }
        Returns: {
          avatar_url: string
          display_name: string
          is_caller: boolean
          sessions_completed: number
          user_id: string
          week_start: string
        }[]
      }
      crew_weekly_progress: {
        Args: { p_crew_id: string }
        Returns: {
          percent_complete: number
          sessions_completed: number
          week_start: string
          weekly_target: number
        }[]
      }
      end_session: {
        Args: { p_session_id?: string }
        Returns: {
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          gym_id: string | null
          id: string
          notes: string | null
          started_at: string
          updated_at: string
          user_id: string
          workout_categories: string[]
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      exercise_progress: {
        Args: never
        Returns: {
          achieved_at: string
          baseline_1rm_kg: number
          current_1rm_kg: number
          exercise_id: string
          exercise_name: string
          improvement_percent: number
        }[]
      }
      find_profile_by_username: {
        Args: { p_username: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          username: string
        }[]
      }
      find_similar_gyms: {
        Args: {
          p_address?: string
          p_latitude: number
          p_limit?: number
          p_longitude: number
          p_name: string
        }
        Returns: {
          address: string
          distance_metres: number
          id: string
          is_probable_duplicate: boolean
          latitude: number
          longitude: number
          match_reason: string
          name: string
        }[]
      }
      friendship_pair: {
        Args: { p_one: string; p_two: string }
        Returns: string[]
      }
      generate_unique_username: { Args: { p_seed: string }; Returns: string }
      gym_friend_visits: {
        Args: { p_gym_id: string }
        Returns: {
          named_visitors: Json
          visitor_count: number
        }[]
      }
      gym_presence: {
        Args: { p_gym_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          since: string
          user_id: string
          username: string
        }[]
      }
      is_blocked_either_way: {
        Args: { p_one: string; p_two: string }
        Returns: boolean
      }
      is_blocked_with_caller: { Args: { p_other: string }; Returns: boolean }
      is_crew_admin: {
        Args: { p_crew_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_crew_member: {
        Args: { p_crew_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_friend_of_caller: { Args: { p_other: string }; Returns: boolean }
      nearby_gyms: {
        Args: {
          p_latitude: number
          p_limit?: number
          p_longitude: number
          p_radius_metres?: number
        }
        Returns: {
          address: string
          distance_metres: number
          id: string
          latitude: number
          longitude: number
          name: string
          opening_hours: string
        }[]
      }
      normalise_place_name: { Args: { p_value: string }; Returns: string }
      purge_expired_presence: { Args: never; Returns: number }
      redeem_crew_invite: { Args: { p_code: string }; Returns: string }
      rescore_challenge: { Args: { p_challenge_id: string }; Returns: number }
      score_challenge_for_user: {
        Args: { p_challenge_id: string; p_user_id: string }
        Returns: number
      }
      session_counts_for_crew: {
        Args: { p_crew_id: string; p_session_id: string }
        Returns: boolean
      }
      share_any_crew: {
        Args: { p_one: string; p_two: string }
        Returns: boolean
      }
      shares_crew_with_caller: { Args: { p_other: string }; Returns: boolean }
      training_streak: {
        Args: never
        Returns: {
          current_streak_weeks: number
          last_session_at: string
          longest_streak_weeks: number
        }[]
      }
      upsert_osm_gym: {
        Args: {
          p_address?: string
          p_city?: string
          p_country_code?: string
          p_latitude: number
          p_longitude: number
          p_name: string
          p_opening_hours?: string
          p_osm_id: string
          p_phone?: string
          p_website?: string
        }
        Returns: string
      }
      week_start: {
        Args: { p_at: string; p_timezone: string }
        Returns: string
      }
      weekly_training_summary: {
        Args: { p_weeks?: number }
        Returns: {
          avg_duration_seconds: number
          session_count: number
          total_duration_seconds: number
          total_volume_kg: number
          week_start: string
        }[]
      }
    }
    Enums: {
      activity_detail_level:
        | "trained_only"
        | "gym_name"
        | "duration"
        | "full_detail"
      challenge_rule_type:
        | "session_count"
        | "weekly_consistency"
        | "distinct_gyms"
        | "time_of_day"
        | "crew_session_total"
        | "exercise_1rm_gain"
      challenge_scope: "personal" | "crew"
      challenge_visibility: "private" | "crew" | "friends"
      crew_leaderboard_metric:
        | "sessions"
        | "consistency_streak"
        | "challenge_contribution"
        | "points"
      crew_role: "owner" | "admin" | "member"
      exercise_equipment:
        | "barbell"
        | "dumbbell"
        | "machine"
        | "cable"
        | "bodyweight"
        | "kettlebell"
        | "bands"
        | "cardio_machine"
        | "other"
      friendship_status: "pending" | "accepted"
      gym_source: "osm" | "user" | "verified"
      muscle_group:
        | "chest"
        | "back"
        | "shoulders"
        | "biceps"
        | "triceps"
        | "forearms"
        | "quads"
        | "hamstrings"
        | "glutes"
        | "calves"
        | "core"
        | "full_body"
        | "cardio"
      presence_visibility: "nobody" | "friends" | "selected_crews" | "all_crews"
      record_type:
        | "max_weight"
        | "estimated_1rm"
        | "max_reps"
        | "max_session_volume"
      report_reason:
        | "permanently_closed"
        | "wrong_location"
        | "duplicate"
        | "inappropriate_content"
        | "spam"
        | "other"
      weight_unit: "lb" | "kg"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_detail_level: [
        "trained_only",
        "gym_name",
        "duration",
        "full_detail",
      ],
      challenge_rule_type: [
        "session_count",
        "weekly_consistency",
        "distinct_gyms",
        "time_of_day",
        "crew_session_total",
        "exercise_1rm_gain",
      ],
      challenge_scope: ["personal", "crew"],
      challenge_visibility: ["private", "crew", "friends"],
      crew_leaderboard_metric: [
        "sessions",
        "consistency_streak",
        "challenge_contribution",
        "points",
      ],
      crew_role: ["owner", "admin", "member"],
      exercise_equipment: [
        "barbell",
        "dumbbell",
        "machine",
        "cable",
        "bodyweight",
        "kettlebell",
        "bands",
        "cardio_machine",
        "other",
      ],
      friendship_status: ["pending", "accepted"],
      gym_source: ["osm", "user", "verified"],
      muscle_group: [
        "chest",
        "back",
        "shoulders",
        "biceps",
        "triceps",
        "forearms",
        "quads",
        "hamstrings",
        "glutes",
        "calves",
        "core",
        "full_body",
        "cardio",
      ],
      presence_visibility: ["nobody", "friends", "selected_crews", "all_crews"],
      record_type: [
        "max_weight",
        "estimated_1rm",
        "max_reps",
        "max_session_volume",
      ],
      report_reason: [
        "permanently_closed",
        "wrong_location",
        "duplicate",
        "inappropriate_content",
        "spam",
        "other",
      ],
      weight_unit: ["lb", "kg"],
    },
  },
} as const
