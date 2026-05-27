import { LucideIcon } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

export interface ToolField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export interface ToolResult {
  summary: string;
  details: Record<string, unknown>;
  tags?: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
  fields: ToolField[];
  process: (inputs: Record<string, string>) => Promise<ToolResult>;
}
