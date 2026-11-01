import { LucideIcon } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

export interface ToolField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "select" | "file";
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  accept?: string;
  fileEncoding?: "base64" | "text" | "video-frames";
  maxFileBytes?: number;
  filenameKey?: string;
}

export interface ToolResult {
  status?: "success" | "partial" | "error" | "not_configured" | "unknown_tool" | "demo";
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
  integration?: {
    provider: string;
    scope: string;
    requiredSecrets?: string[];
  };
  process: (inputs: Record<string, string>) => Promise<ToolResult>;
}
