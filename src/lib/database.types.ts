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
      address_cache: {
        Row: {
          address_norm: string
          created_at: string
          lat: number | null
          lng: number | null
          source: string | null
        }
        Insert: {
          address_norm: string
          created_at?: string
          lat?: number | null
          lng?: number | null
          source?: string | null
        }
        Update: {
          address_norm?: string
          created_at?: string
          lat?: number | null
          lng?: number | null
          source?: string | null
        }
        Relationships: []
      }
      agenda_item_locations: {
        Row: {
          agenda_item_id: string
          district: number | null
          geocode_source: string | null
          geocoded_at: string | null
          id: string
          lat: number | null
          lng: number | null
          neighborhood: string | null
          raw_address: string
        }
        Insert: {
          agenda_item_id: string
          district?: number | null
          geocode_source?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          neighborhood?: string | null
          raw_address: string
        }
        Update: {
          agenda_item_id?: string
          district?: number | null
          geocode_source?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          neighborhood?: string | null
          raw_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_item_locations_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_items"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_items: {
        Row: {
          comment_deadline: string | null
          comment_email: string | null
          comment_portal_url: string | null
          district: number | null
          id: string
          in_person_slot: string | null
          item_type: string | null
          llm_extracted_at: string | null
          llm_model: string | null
          meeting_id: string
          neighborhoods: string[]
          position: number | null
          prompt_version: string | null
          search_tsv: unknown
          summary: string | null
          title: string
          topics: string[]
        }
        Insert: {
          comment_deadline?: string | null
          comment_email?: string | null
          comment_portal_url?: string | null
          district?: number | null
          id?: string
          in_person_slot?: string | null
          item_type?: string | null
          llm_extracted_at?: string | null
          llm_model?: string | null
          meeting_id: string
          neighborhoods?: string[]
          position?: number | null
          prompt_version?: string | null
          search_tsv?: unknown
          summary?: string | null
          title: string
          topics?: string[]
        }
        Update: {
          comment_deadline?: string | null
          comment_email?: string | null
          comment_portal_url?: string | null
          district?: number | null
          id?: string
          in_person_slot?: string | null
          item_type?: string | null
          llm_extracted_at?: string | null
          llm_model?: string | null
          meeting_id?: string
          neighborhoods?: string[]
          position?: number | null
          prompt_version?: string | null
          search_tsv?: unknown
          summary?: string | null
          title?: string
          topics?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "agenda_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          agenda_url: string | null
          content_hash: string
          external_id: string | null
          id: string
          location: string | null
          meeting_date: string
          meeting_time: string | null
          needs_ocr: boolean
          raw_storage_path: string | null
          scraped_at: string
          source_id: string
          title: string
        }
        Insert: {
          agenda_url?: string | null
          content_hash: string
          external_id?: string | null
          id?: string
          location?: string | null
          meeting_date: string
          meeting_time?: string | null
          needs_ocr?: boolean
          raw_storage_path?: string | null
          scraped_at?: string
          source_id: string
          title: string
        }
        Update: {
          agenda_url?: string | null
          content_hash?: string
          external_id?: string | null
          id?: string
          location?: string | null
          meeting_date?: string
          meeting_time?: string | null
          needs_ocr?: boolean
          raw_storage_path?: string | null
          scraped_at?: string
          source_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          items_found: number | null
          items_new: number | null
          source_id: string
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          items_found?: number | null
          items_new?: number | null
          source_id: string
          started_at?: string
          status: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          items_found?: number | null
          items_new?: number | null
          source_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: string
          name: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          url?: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
