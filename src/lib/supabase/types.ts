export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      recommendations: {
        Row: {
          slug: string;
          title: string;
          concern: string;
          skin_type: string;
          summary: string;
          routine: Json;
          avoid: Json;
          seo_title: string;
          seo_description: string;
          created_at: string;
        };
        Insert: {
          slug: string;
          title: string;
          concern: string;
          skin_type: string;
          summary: string;
          routine?: Json;
          avoid?: Json;
          seo_title: string;
          seo_description: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["recommendations"]["Insert"]>;
        Relationships: [];
      };
      outbound_clicks: {
        Row: {
          id: number;
          product_id: string;
          product_name: string;
          destination_url: string;
          recommendation_slug: string | null;
          referrer: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          product_id: string;
          product_name: string;
          destination_url: string;
          recommendation_slug?: string | null;
          referrer?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["outbound_clicks"]["Insert"]>;
        Relationships: [];
      };
      partner_domains: {
        Row: {
          id: string;
          owner_id: string | null;
          domain: string;
          display_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          domain: string;
          display_name: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["partner_domains"]["Insert"]>;
        Relationships: [];
      };
      shopify_shops: {
        Row: {
          shop_domain: string;
          tenant_id: string;
          access_token: string;
          scopes: string | null;
          installed_at: string;
          last_sync_at: string | null;
          last_sync_count: number | null;
          updated_at: string;
        };
        Insert: {
          shop_domain: string;
          tenant_id: string;
          access_token: string;
          scopes?: string | null;
          installed_at?: string;
          last_sync_at?: string | null;
          last_sync_count?: number | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["shopify_shops"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
