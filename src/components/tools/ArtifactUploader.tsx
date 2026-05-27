import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Loader2, FileImage, FileText, File, X } from "lucide-react";

const ACCEPTED = "image/*,.pdf,.doc,.docx,.txt,.csv,.json,.xml,.html,.log,.pcap,.eml,.msg";
const MAX_SIZE_MB = 20;

const fileIcon = (type: string) => {
  if (type.startsWith("image/")) return FileImage;
  if (type.includes("pdf") || type.includes("document") || type.includes("text")) return FileText;
  return File;
};

interface Props {
  caseId: string;
  onUploaded?: () => void;
}

export function ArtifactUploader({ caseId, onUploaded }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const valid = Array.from(incoming).filter((f) => f.size <= MAX_SIZE_MB * 1024 * 1024);
    if (valid.length < (incoming?.length ?? 0)) toast.error(`Files over ${MAX_SIZE_MB}MB were skipped`);
    setFiles((prev) => [...prev, ...valid]);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const upload = async () => {
    if (!user || files.length === 0) return;
    setUploading(true);
    let successCount = 0;

    for (const file of files) {
      const ext = file.name.split(".").pop() ?? "bin";
      const storagePath = `${user.id}/${caseId}/${crypto.randomUUID()}.${ext}`;

      // Upload to storage
      const { error: storageErr } = await supabase.storage
        .from("artifacts")
        .upload(storagePath, file, { contentType: file.type });

      if (storageErr) {
        toast.error(`Failed to upload ${file.name}: ${storageErr.message}`);
        continue;
      }

      // Create artifact record
      const artifactType = file.type.startsWith("image/")
        ? "image"
        : file.type.includes("pdf")
        ? "document"
        : "file";

      const { error: dbErr } = await supabase.from("artifacts").insert({
        case_id: caseId,
        artifact_type: artifactType,
        data: JSON.stringify({
          storage_path: storagePath,
          original_name: file.name,
          content_type: file.type,
          size_bytes: file.size,
        }),
      });

      if (dbErr) {
        toast.error(`Failed to save record for ${file.name}: ${dbErr.message}`);
        continue;
      }

      successCount++;
    }

    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? "s" : ""} uploaded`);
      qc.invalidateQueries({ queryKey: ["artifacts", caseId] });
      onUploaded?.();
    }

    setFiles([]);
    setUploading(false);
  };

  return (
    <GlassPanel className="p-4 space-y-3" neonLine="top">
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">UPLOAD EVIDENCE FILES</span>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40"
        }`}
      >
        <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">
          Drop files here or <span className="text-primary">browse</span>
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          Images, documents, screenshots, raw evidence — max {MAX_SIZE_MB}MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => {
            const Icon = fileIcon(f.type);
            return (
              <div key={i} className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-2 text-xs">
                <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate flex-1 text-foreground">{f.name}</span>
                <span className="text-muted-foreground font-mono shrink-0">
                  {(f.size / 1024).toFixed(0)}KB
                </span>
                <button onClick={() => removeFile(i)} className="shrink-0 p-0.5 hover:text-destructive transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          <Button variant="neon" size="sm" className="w-full" onClick={upload} disabled={uploading}>
            {uploading ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />UPLOADING...</>
            ) : (
              <><Upload className="h-3.5 w-3.5 mr-2" />UPLOAD {files.length} FILE{files.length > 1 ? "S" : ""}</>
            )}
          </Button>
        </div>
      )}
    </GlassPanel>
  );
}
