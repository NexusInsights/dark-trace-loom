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
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          agent_id: string
          case_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          input_data: Json | null
          results: Json | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          agent_id: string
          case_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          input_data?: Json | null
          results?: Json | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          case_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          input_data?: Json | null
          results?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          tool_sequence: string[]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          tool_sequence?: string[]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          tool_sequence?: string[]
        }
        Relationships: []
      }
      alert_notifications: {
        Row: {
          alert_id: string
          created_at: string
          id: string
          message: string | null
          metadata: Json | null
          read: boolean
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          alert_id: string
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          read?: boolean
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          alert_id?: string
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          read?: boolean
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          conditions: Json | null
          created_at: string
          enabled: boolean
          frequency: string
          id: string
          last_checked: string | null
          last_triggered: string | null
          subject_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_type: string
          conditions?: Json | null
          created_at?: string
          enabled?: boolean
          frequency?: string
          id?: string
          last_checked?: string | null
          last_triggered?: string | null
          subject_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_type?: string
          conditions?: Json | null
          created_at?: string
          enabled?: boolean
          frequency?: string
          id?: string
          last_checked?: string | null
          last_triggered?: string | null
          subject_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_reports: {
        Row: {
          analysis_type: string
          case_id: string
          created_at: string
          generated_summary: string
          id: string
          key_findings: Json | null
          key_relationships: Json | null
          model_used: string | null
          narrative_draft: string | null
          suspicious_patterns: Json | null
          user_id: string
        }
        Insert: {
          analysis_type?: string
          case_id: string
          created_at?: string
          generated_summary: string
          id?: string
          key_findings?: Json | null
          key_relationships?: Json | null
          model_used?: string | null
          narrative_draft?: string | null
          suspicious_patterns?: Json | null
          user_id: string
        }
        Update: {
          analysis_type?: string
          case_id?: string
          created_at?: string
          generated_summary?: string
          id?: string
          key_findings?: Json | null
          key_relationships?: Json | null
          model_used?: string | null
          narrative_draft?: string | null
          suspicious_patterns?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_reports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          active: boolean
          created_at: string
          id: string
          key: string
          label: string
          plan: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          key: string
          label?: string
          plan?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          key?: string
          label?: string
          plan?: string
          user_id?: string
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          endpoint: string
          id: string
          key_id: string
          method: string
          status_code: number
          timestamp: string
        }
        Insert: {
          endpoint: string
          id?: string
          key_id: string
          method?: string
          status_code?: number
          timestamp?: string
        }
        Update: {
          endpoint?: string
          id?: string
          key_id?: string
          method?: string
          status_code?: number
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content?: string
          created_at?: string
          id?: string
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      artifacts: {
        Row: {
          artifact_type: string
          case_id: string
          created_at: string
          data: string | null
          id: string
        }
        Insert: {
          artifact_type: string
          case_id: string
          created_at?: string
          data?: string | null
          id?: string
        }
        Update: {
          artifact_type?: string
          case_id?: string
          created_at?: string
          data?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          data: Json | null
          event_type: string
          id: string
          stripe_customer_id: string | null
          stripe_event_id: string
          stripe_subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          event_type: string
          id?: string
          stripe_customer_id?: string | null
          stripe_event_id: string
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          event_type?: string
          id?: string
          stripe_customer_id?: string | null
          stripe_event_id?: string
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      breach_records: {
        Row: {
          breach_date: string | null
          breach_name: string | null
          breach_source: string | null
          created_at: string
          credential_leaked: boolean | null
          data_classes: Json | null
          data_exposed: string[] | null
          entity_id: string | null
          id: string
          identifier: string | null
          metadata: Json | null
          password_reuse_detected: boolean | null
          raw_response: Json | null
          severity: string
          source: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          breach_date?: string | null
          breach_name?: string | null
          breach_source?: string | null
          created_at?: string
          credential_leaked?: boolean | null
          data_classes?: Json | null
          data_exposed?: string[] | null
          entity_id?: string | null
          id?: string
          identifier?: string | null
          metadata?: Json | null
          password_reuse_detected?: boolean | null
          raw_response?: Json | null
          severity?: string
          source?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          breach_date?: string | null
          breach_name?: string | null
          breach_source?: string | null
          created_at?: string
          credential_leaked?: boolean | null
          data_classes?: Json | null
          data_exposed?: string[] | null
          entity_id?: string | null
          id?: string
          identifier?: string | null
          metadata?: Json | null
          password_reuse_detected?: boolean | null
          raw_response?: Json | null
          severity?: string
          source?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "breach_records_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      case_collaborators: {
        Row: {
          case_id: string
          created_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["case_collaborator_role"]
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["case_collaborator_role"]
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["case_collaborator_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_collaborators_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          created_at: string
          description: string | null
          id: string
          organization_id: string | null
          owner_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string | null
          owner_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string | null
          owner_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cluster_members: {
        Row: {
          cluster_id: string
          confidence_score: number
          created_at: string
          entity_id: string
          id: string
          join_reason: string | null
          user_id: string
        }
        Insert: {
          cluster_id: string
          confidence_score?: number
          created_at?: string
          entity_id: string
          id?: string
          join_reason?: string | null
          user_id: string
        }
        Update: {
          cluster_id?: string
          confidence_score?: number
          created_at?: string
          entity_id?: string
          id?: string
          join_reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cluster_members_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "identity_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cluster_members_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          author_id: string
          created_at: string
          description: string | null
          difficulty: string
          id: string
          published: boolean
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          created_at?: string
          description?: string | null
          difficulty?: string
          id?: string
          published?: boolean
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          description?: string | null
          difficulty?: string
          id?: string
          published?: boolean
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      cross_case_correlations: {
        Row: {
          confidence: number
          created_at: string
          id: string
          relationship_type: string
          source_artifact_id: string | null
          source_case_id: string
          source_type: string
          source_value: string
          target_artifact_id: string | null
          target_case_id: string
          target_type: string
          target_value: string
          user_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          id?: string
          relationship_type: string
          source_artifact_id?: string | null
          source_case_id: string
          source_type: string
          source_value: string
          target_artifact_id?: string | null
          target_case_id: string
          target_type: string
          target_value: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          relationship_type?: string
          source_artifact_id?: string | null
          source_case_id?: string
          source_type?: string
          source_value?: string
          target_artifact_id?: string | null
          target_case_id?: string
          target_type?: string
          target_value?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_case_correlations_source_artifact_id_fkey"
            columns: ["source_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_case_correlations_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_case_correlations_target_artifact_id_fkey"
            columns: ["target_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_case_correlations_target_case_id_fkey"
            columns: ["target_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_case_links: {
        Row: {
          acknowledged: boolean
          case_id: string
          created_at: string
          entity_id: string
          id: string
          link_reason: string
          linked_case_id: string
          metadata: Json | null
          severity: string
          user_id: string
        }
        Insert: {
          acknowledged?: boolean
          case_id: string
          created_at?: string
          entity_id: string
          id?: string
          link_reason: string
          linked_case_id: string
          metadata?: Json | null
          severity?: string
          user_id: string
        }
        Update: {
          acknowledged?: boolean
          case_id?: string
          created_at?: string
          entity_id?: string
          id?: string
          link_reason?: string
          linked_case_id?: string
          metadata?: Json | null
          severity?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_case_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_case_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_case_links_linked_case_id_fkey"
            columns: ["linked_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      email_candidates: {
        Row: {
          candidate_email: string
          confidence_score: number
          created_at: string
          generation_method: string
          id: string
          persona_id: string
          user_id: string
        }
        Insert: {
          candidate_email: string
          confidence_score?: number
          created_at?: string
          generation_method?: string
          id?: string
          persona_id: string
          user_id: string
        }
        Update: {
          candidate_email?: string
          confidence_score?: number
          created_at?: string
          generation_method?: string
          id?: string
          persona_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_candidates_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          case_id: string
          created_at: string
          entity_type: string
          id: string
          label: string
          metadata: Json | null
        }
        Insert: {
          case_id: string
          created_at?: string
          entity_type: string
          id?: string
          label: string
          metadata?: Json | null
        }
        Update: {
          case_id?: string
          created_at?: string
          entity_type?: string
          id?: string
          label?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_monitors: {
        Row: {
          created_at: string
          enabled: boolean
          entity_id: string
          frequency: string
          id: string
          last_checked: string | null
          last_triggered: string | null
          monitor_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          entity_id: string
          frequency?: string
          id?: string
          last_checked?: string | null
          last_triggered?: string | null
          monitor_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          entity_id?: string
          frequency?: string
          id?: string
          last_checked?: string | null
          last_triggered?: string | null
          monitor_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_monitors_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_observations: {
        Row: {
          case_id: string | null
          created_at: string
          entity_id: string
          id: string
          metadata: Json | null
          observed_value: string
          source_tool: string | null
          user_id: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          entity_id: string
          id?: string
          metadata?: Json | null
          observed_value: string
          source_tool?: string | null
          user_id: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          entity_id?: string
          id?: string
          metadata?: Json | null
          observed_value?: string
          source_tool?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_observations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_observations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_relationships: {
        Row: {
          case_id: string
          confidence: number | null
          created_at: string
          id: string
          notes: string | null
          relationship_type: string
          source_id: string
          target_id: string
        }
        Insert: {
          case_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          relationship_type: string
          source_id: string
          target_id: string
        }
        Update: {
          case_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          relationship_type?: string
          source_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_scores: {
        Row: {
          case_appearances: number | null
          created_at: string
          entity_id: string
          id: string
          infrastructure_overlap: number | null
          linked_identifiers: number | null
          relationship_density: number | null
          score: number
          score_reasons: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          case_appearances?: number | null
          created_at?: string
          entity_id: string
          id?: string
          infrastructure_overlap?: number | null
          linked_identifiers?: number | null
          relationship_density?: number | null
          score?: number
          score_reasons?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          case_appearances?: number | null
          created_at?: string
          entity_id?: string
          id?: string
          infrastructure_overlap?: number | null
          linked_identifiers?: number | null
          relationship_density?: number | null
          score?: number
          score_reasons?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_scores_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_timeline: {
        Row: {
          created_at: string
          description: string | null
          entity_id: string
          event_timestamp: string
          event_type: string
          id: string
          metadata: Json | null
          source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_id: string
          event_timestamp?: string
          event_type: string
          id?: string
          metadata?: Json | null
          source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_id?: string
          event_timestamp?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_timeline_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          case_id: string
          created_at: string
          description: string | null
          event_type: string | null
          id: string
          timestamp: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          description?: string | null
          event_type?: string | null
          id?: string
          timestamp?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          description?: string | null
          event_type?: string | null
          id?: string
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_logs: {
        Row: {
          action: string
          artifact_id: string
          hash: string
          id: string
          timestamp: string
          user_id: string
        }
        Insert: {
          action: string
          artifact_id: string
          hash: string
          id?: string
          timestamp?: string
          user_id: string
        }
        Update: {
          action?: string
          artifact_id?: string
          hash?: string
          id?: string
          timestamp?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_logs_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      expansion_logs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          result: Json | null
          status: string
          step: string
          trigger_entity_id: string | null
          trigger_type: string
          trigger_value: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          result?: Json | null
          status?: string
          step: string
          trigger_entity_id?: string | null
          trigger_type: string
          trigger_value: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          result?: Json | null
          status?: string
          step?: string
          trigger_entity_id?: string | null
          trigger_type?: string
          trigger_value?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expansion_logs_trigger_entity_id_fkey"
            columns: ["trigger_entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_clusters: {
        Row: {
          cluster_label: string
          cluster_score: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cluster_label?: string
          cluster_score?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cluster_label?: string
          cluster_score?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      identity_entities: {
        Row: {
          confidence_score: number
          created_at: string
          entity_type: string
          entity_value: string
          id: string
          metadata: Json | null
          source_case_id: string | null
          source_tool: string | null
          user_id: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          entity_type: string
          entity_value: string
          id?: string
          metadata?: Json | null
          source_case_id?: string | null
          source_tool?: string | null
          user_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          entity_type?: string
          entity_value?: string
          id?: string
          metadata?: Json | null
          source_case_id?: string | null
          source_tool?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_entities_source_case_id_fkey"
            columns: ["source_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_entity_links: {
        Row: {
          confidence_score: number
          created_at: string
          evidence: string | null
          id: string
          relationship_type: string
          source_entity_id: string
          target_entity_id: string
          user_id: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          evidence?: string | null
          id?: string
          relationship_type: string
          source_entity_id: string
          target_entity_id: string
          user_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          evidence?: string | null
          id?: string
          relationship_type?: string
          source_entity_id?: string
          target_entity_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      infrastructure_links: {
        Row: {
          confidence_score: number
          created_at: string
          entity_id: string
          id: string
          infrastructure_type: string
          metadata: Json | null
          source_tool: string | null
          user_id: string
          value: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          entity_id: string
          id?: string
          infrastructure_type: string
          metadata?: Json | null
          source_tool?: string | null
          user_id: string
          value: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          entity_id?: string
          id?: string
          infrastructure_type?: string
          metadata?: Json | null
          source_tool?: string | null
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "infrastructure_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_suggestions: {
        Row: {
          case_id: string
          confidence_score: number
          created_at: string
          dismissed: boolean
          executed: boolean
          id: string
          metadata: Json | null
          recommended_tool: string
          tool_description: string | null
          trigger_type: string
          trigger_value: string
          user_id: string
        }
        Insert: {
          case_id: string
          confidence_score?: number
          created_at?: string
          dismissed?: boolean
          executed?: boolean
          id?: string
          metadata?: Json | null
          recommended_tool: string
          tool_description?: string | null
          trigger_type: string
          trigger_value: string
          user_id: string
        }
        Update: {
          case_id?: string
          confidence_score?: number
          created_at?: string
          dismissed?: boolean
          executed?: boolean
          id?: string
          metadata?: Json | null
          recommended_tool?: string
          tool_description?: string | null
          trigger_type?: string
          trigger_value?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_suggestions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_templates: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          tool_sequence: string[]
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          tool_sequence?: string[]
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          tool_sequence?: string[]
        }
        Relationships: []
      }
      lessons: {
        Row: {
          content: string
          created_at: string
          id: string
          module_id: string
          sort_order: number
          title: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          module_id: string
          sort_order?: number
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          module_id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          id: string
          sort_order: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          avatar_url: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      pdl_lookups: {
        Row: {
          created_at: string
          id: string
          inputs: Json
          label: string
          lookup_type: string
          result: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inputs?: Json
          label?: string
          lookup_type: string
          result?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inputs?: Json
          label?: string
          lookup_type?: string
          result?: Json
          user_id?: string
        }
        Relationships: []
      }
      persona_events: {
        Row: {
          created_at: string
          event_label: string
          event_timestamp: string
          event_type: string
          id: string
          metadata: Json | null
          persona_id: string
          source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_label?: string
          event_timestamp?: string
          event_type: string
          id?: string
          metadata?: Json | null
          persona_id: string
          source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_label?: string
          event_timestamp?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          persona_id?: string
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_events_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_identifiers: {
        Row: {
          confidence_score: number
          created_at: string
          id: string
          identifier_type: string
          identifier_value: string
          persona_id: string
          source: string | null
          user_id: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          id?: string
          identifier_type: string
          identifier_value: string
          persona_id: string
          source?: string | null
          user_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          id?: string
          identifier_type?: string
          identifier_value?: string
          persona_id?: string
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "persona_identifiers_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          persona_label: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          persona_label: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          persona_label?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          artifacts_created: number | null
          completed_at: string | null
          created_at: string
          entities_linked: number | null
          errors: Json | null
          id: string
          pipeline_id: string
          results: Json | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          artifacts_created?: number | null
          completed_at?: string | null
          created_at?: string
          entities_linked?: number | null
          errors?: Json | null
          id?: string
          pipeline_id: string
          results?: Json | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          artifacts_created?: number | null
          completed_at?: string | null
          created_at?: string
          entities_linked?: number | null
          errors?: Json | null
          id?: string
          pipeline_id?: string
          results?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          input_params: Json | null
          last_run_at: string | null
          name: string
          schedule: string
          target_case_id: string | null
          target_entity_ids: string[] | null
          tool_sequence: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          input_params?: Json | null
          last_run_at?: string | null
          name: string
          schedule?: string
          target_case_id?: string | null
          target_entity_ids?: string[] | null
          tool_sequence?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          input_params?: Json | null
          last_run_at?: string | null
          name?: string
          schedule?: string
          target_case_id?: string | null
          target_entity_ids?: string[] | null
          tool_sequence?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_target_case_id_fkey"
            columns: ["target_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_accounts: {
        Row: {
          account_identifier: string
          confidence_score: number
          created_at: string
          id: string
          metadata: Json | null
          persona_id: string
          platform_category: string
          platform_name: string
          profile_url: string | null
          user_id: string
          verified: boolean
        }
        Insert: {
          account_identifier: string
          confidence_score?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          persona_id: string
          platform_category?: string
          platform_name: string
          profile_url?: string | null
          user_id: string
          verified?: boolean
        }
        Update: {
          account_identifier?: string
          confidence_score?: number
          created_at?: string
          id?: string
          metadata?: Json | null
          persona_id?: string
          platform_category?: string
          platform_name?: string
          profile_url?: string | null
          user_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "platform_accounts_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          name: string | null
          role: string
        }
        Insert: {
          created_at?: string
          id: string
          name?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          role?: string
        }
        Relationships: []
      }
      progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          course_id: string
          created_at: string
          id: string
          lesson_id: string | null
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          course_id: string
          created_at?: string
          id?: string
          lesson_id?: string | null
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          course_id?: string
          created_at?: string
          id?: string
          lesson_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progress_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          case_id: string
          created_at: string
          file_path: string | null
          file_size: number | null
          format: string
          id: string
          metadata: Json | null
          report_type: string
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          file_path?: string | null
          file_size?: number | null
          format: string
          id?: string
          metadata?: Json | null
          report_type: string
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          file_path?: string | null
          file_size?: number | null
          format?: string
          id?: string
          metadata?: Json | null
          report_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      similarity_scores: {
        Row: {
          analysis_method: string
          created_at: string
          details: Json | null
          entity_a: string
          entity_b: string
          id: string
          infrastructure_similarity: number | null
          metadata_similarity: number | null
          similarity_score: number
          temporal_similarity: number | null
          updated_at: string
          user_id: string
          username_similarity: number | null
        }
        Insert: {
          analysis_method?: string
          created_at?: string
          details?: Json | null
          entity_a: string
          entity_b: string
          id?: string
          infrastructure_similarity?: number | null
          metadata_similarity?: number | null
          similarity_score?: number
          temporal_similarity?: number | null
          updated_at?: string
          user_id: string
          username_similarity?: number | null
        }
        Update: {
          analysis_method?: string
          created_at?: string
          details?: Json | null
          entity_a?: string
          entity_b?: string
          id?: string
          infrastructure_similarity?: number | null
          metadata_similarity?: number | null
          similarity_score?: number
          temporal_similarity?: number | null
          updated_at?: string
          user_id?: string
          username_similarity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "similarity_scores_entity_a_fkey"
            columns: ["entity_a"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "similarity_scores_entity_b_fkey"
            columns: ["entity_b"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      social_graph_edges: {
        Row: {
          confidence_score: number
          created_at: string
          evidence: string | null
          id: string
          metadata: Json | null
          relationship_type: string
          source_entity_id: string
          source_tool: string | null
          target_entity_id: string
          user_id: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          evidence?: string | null
          id?: string
          metadata?: Json | null
          relationship_type: string
          source_entity_id: string
          source_tool?: string | null
          target_entity_id: string
          user_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          evidence?: string | null
          id?: string
          metadata?: Json | null
          relationship_type?: string
          source_entity_id?: string
          source_tool?: string | null
          target_entity_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_graph_edges_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_graph_edges_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "identity_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          case_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          type: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          type: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          level: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          level?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      tool_marketplace: {
        Row: {
          category: string
          config_schema: Json | null
          created_at: string
          description: string | null
          developer_id: string
          developer_name: string
          downloads: number
          icon_name: string | null
          id: string
          long_description: string | null
          min_plan: string
          pricing_model: string
          rating: number | null
          slug: string
          status: string
          tags: string[] | null
          tool_name: string
          updated_at: string
          version: string
        }
        Insert: {
          category?: string
          config_schema?: Json | null
          created_at?: string
          description?: string | null
          developer_id: string
          developer_name: string
          downloads?: number
          icon_name?: string | null
          id?: string
          long_description?: string | null
          min_plan?: string
          pricing_model?: string
          rating?: number | null
          slug: string
          status?: string
          tags?: string[] | null
          tool_name: string
          updated_at?: string
          version?: string
        }
        Update: {
          category?: string
          config_schema?: Json | null
          created_at?: string
          description?: string | null
          developer_id?: string
          developer_name?: string
          downloads?: number
          icon_name?: string | null
          id?: string
          long_description?: string | null
          min_plan?: string
          pricing_model?: string
          rating?: number | null
          slug?: string
          status?: string
          tags?: string[] | null
          tool_name?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      tool_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          tool_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          tool_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          tool_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tool_results: {
        Row: {
          case_id: string | null
          created_at: string
          id: string
          result_data: Json | null
          status: string | null
          tool_name: string
          user_id: string | null
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          id?: string
          result_data?: Json | null
          status?: string | null
          tool_name: string
          user_id?: string | null
        }
        Update: {
          case_id?: string | null
          created_at?: string
          id?: string
          result_data?: Json | null
          status?: string | null
          tool_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tool_results_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_metrics: {
        Row: {
          created_at: string
          executions: number
          id: string
          period_end: string
          period_start: string
          tool_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          executions?: number
          id?: string
          period_end: string
          period_start: string
          tool_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          executions?: number
          id?: string
          period_end?: string
          period_start?: string
          tool_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_installed_tools: {
        Row: {
          enabled: boolean
          id: string
          installed_at: string
          tool_id: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          id?: string
          installed_at?: string
          tool_id: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          id?: string
          installed_at?: string
          tool_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_installed_tools_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tool_marketplace"
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
      username_candidates: {
        Row: {
          candidate_username: string
          confidence_score: number
          created_at: string
          generation_method: string
          id: string
          persona_id: string
          user_id: string
        }
        Insert: {
          candidate_username: string
          confidence_score?: number
          created_at?: string
          generation_method?: string
          id?: string
          persona_id: string
          user_id: string
        }
        Update: {
          candidate_username?: string
          confidence_score?: number
          created_at?: string
          generation_method?: string
          id?: string
          persona_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "username_candidates_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_case: {
        Args: { _case_id: string; _user_id: string }
        Returns: boolean
      }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["org_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_case_collaborator: {
        Args: { _case_id: string; _user_id: string }
        Returns: boolean
      }
      is_case_owner: {
        Args: { _case_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      case_collaborator_role: "viewer" | "investigator" | "legal_reviewer"
      org_role: "owner" | "admin" | "investigator" | "viewer"
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
      case_collaborator_role: ["viewer", "investigator", "legal_reviewer"],
      org_role: ["owner", "admin", "investigator", "viewer"],
    },
  },
} as const
