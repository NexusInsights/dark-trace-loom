import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassPanel, IntelCard } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText, Search, Plus, X, ArrowLeft, Clock,
  Tag, Loader2, Edit2, Trash2, Save, ChevronRight,
} from "lucide-react";

// ─── Data hooks ───
function useArticles(search: string, tagFilter: string) {
  return useQuery({
    queryKey: ["articles", search, tagFilter],
    queryFn: async () => {
      let q = supabase.from("articles").select("*").order("updated_at", { ascending: false });
      if (search) q = q.or(`title.ilike.%${search}%,content.ilike.%${search}%,summary.ilike.%${search}%`);
      if (tagFilter) q = q.contains("tags", [tagFilter]);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useAllTags() {
  return useQuery({
    queryKey: ["kb-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      return data ?? [];
    },
  });
}

// ─── Article editor ───
function ArticleEditor({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { title: string; content: string; summary: string; tags: string[] };
  onSave: (data: { title: string; content: string; summary: string; tags: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [tagsInput, setTagsInput] = useState(initial?.tags?.join(", ") ?? "");
  const [preview, setPreview] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = tagsInput.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    onSave({ title, content, summary, tags });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TITLE</label>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Article title..."
        />
      </div>
      <div className="space-y-1">
        <label className="font-mono text-[10px] tracking-widest text-muted-foreground">SUMMARY</label>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Brief description..."
        />
      </div>
      <div className="space-y-1">
        <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TAGS (comma separated)</label>
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="osint, methodology, dns..."
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">CONTENT (MARKDOWN)</label>
          <button
            type="button"
            onClick={() => setPreview(!preview)}
            className="text-[10px] font-mono text-primary hover:underline"
          >
            {preview ? "EDIT" : "PREVIEW"}
          </button>
        </div>
        {preview ? (
          <div className="bg-secondary/50 border border-border rounded p-4 min-h-[250px] prose-intel">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
            placeholder="Write your article in Markdown..."
          />
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="neon" size="sm" disabled={saving} className="flex-1">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />}
          {initial ? "UPDATE" : "PUBLISH"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>CANCEL</Button>
      </div>
    </form>
  );
}

// ─── Main page ───
export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [view, setView] = useState<"list" | "create" | "read" | "edit">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: articles = [], isLoading } = useArticles(search, tagFilter);
  const { data: allTags = [] } = useAllTags();
  const selectedArticle = articles.find((a) => a.id === selectedId);

  // Mutations
  const createArticle = useMutation({
    mutationFn: async (input: { title: string; content: string; summary: string; tags: string[] }) => {
      // Upsert tags
      for (const tag of input.tags) {
        await supabase.from("tags").upsert({ name: tag }, { onConflict: "name" });
      }
      const { error } = await supabase.from("articles").insert({
        ...input,
        author_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["kb-tags"] });
      toast.success("Article published");
      setView("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateArticle = useMutation({
    mutationFn: async (input: { id: string; title: string; content: string; summary: string; tags: string[] }) => {
      for (const tag of input.tags) {
        await supabase.from("tags").upsert({ name: tag }, { onConflict: "name" });
      }
      const { id, ...rest } = input;
      const { error } = await supabase.from("articles").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["kb-tags"] });
      toast.success("Article updated");
      setView("read");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteArticle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("articles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["articles"] });
      toast.success("Article deleted");
      setView("list");
      setSelectedId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Unique tags from articles for quick filter
  const usedTags = Array.from(new Set(articles.flatMap((a) => a.tags ?? [])));

  // ─── READ VIEW ───
  if (view === "read" && selectedArticle) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-fade-in space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => { setView("list"); setSelectedId(null); }} className="p-1.5 rounded hover:bg-secondary transition-colors">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">KNOWLEDGE BASE</span>
        </div>

        <GlassPanel className="p-6 space-y-4" neonLine="top">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-display font-bold tracking-tight">{selectedArticle.title}</h1>
              {selectedArticle.summary && (
                <p className="text-sm text-muted-foreground mt-1">{selectedArticle.summary}</p>
              )}
              <div className="flex items-center gap-3 mt-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(selectedArticle.created_at).toLocaleDateString()}
                </span>
                {(selectedArticle.tags ?? []).map((t: string) => (
                  <span key={t} className="intel-tag intel-tag-blue flex items-center gap-1">
                    <Tag className="h-2.5 w-2.5" />{t}
                  </span>
                ))}
              </div>
            </div>
            {selectedArticle.author_id === user?.id && (
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => setView("edit")}
                  className="p-1.5 rounded hover:bg-secondary transition-colors"
                >
                  <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={() => deleteArticle.mutate(selectedArticle.id)}
                  className="p-1.5 rounded hover:bg-destructive/20 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-border/50 pt-4 prose-intel">
            <ReactMarkdown>{selectedArticle.content}</ReactMarkdown>
          </div>
        </GlassPanel>
      </div>
    );
  }

  // ─── CREATE / EDIT VIEW ───
  if (view === "create" || (view === "edit" && selectedArticle)) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-fade-in space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setView(selectedArticle ? "read" : "list")} className="p-1.5 rounded hover:bg-secondary transition-colors">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
            {view === "edit" ? "EDIT ARTICLE" : "NEW ARTICLE"}
          </span>
        </div>

        <GlassPanel className="p-5" neonLine="top">
          <ArticleEditor
            initial={view === "edit" && selectedArticle ? {
              title: selectedArticle.title,
              content: selectedArticle.content,
              summary: selectedArticle.summary ?? "",
              tags: selectedArticle.tags ?? [],
            } : undefined}
            saving={createArticle.isPending || updateArticle.isPending}
            onCancel={() => setView(selectedArticle ? "read" : "list")}
            onSave={(data) => {
              if (view === "edit" && selectedArticle) {
                updateArticle.mutate({ id: selectedArticle.id, ...data });
              } else {
                createArticle.mutate(data);
              }
            }}
          />
        </GlassPanel>
      </div>
    );
  }

  // ─── LIST VIEW ───
  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <span className="intel-tag intel-tag-purple mb-3 inline-block">RESTRICTED</span>
          <h1 className="text-2xl font-display font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">Documentation, guides, and intelligence resources</p>
        </div>
        <Button variant="neon" size="sm" onClick={() => setView("create")}>
          <Plus className="h-3 w-3 mr-2" /> NEW ARTICLE
        </Button>
      </div>

      {/* Search + Tags */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles..."
            className="w-full bg-secondary border border-border rounded pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setTagFilter("")}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              !tagFilter ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            ALL
          </button>
          {(allTags.length > 0 ? allTags.map((t) => t.name) : usedTags).slice(0, 10).map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                tagFilter === tag ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Articles list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : articles.length === 0 ? (
        <GlassPanel className="p-12 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">
            {search || tagFilter ? "NO ARTICLES MATCH YOUR SEARCH" : "NO ARTICLES YET"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {search || tagFilter ? "Try different search terms" : "Create your first knowledge base article"}
          </p>
        </GlassPanel>
      ) : (
        <div className="space-y-2">
          {articles.map((a) => (
            <GlassPanel
              key={a.id}
              className="p-4 flex items-center gap-3 hover:glow-blue transition-all duration-200 cursor-pointer group"
            >
              <button
                onClick={() => { setSelectedId(a.id); setView("read"); }}
                className="flex-1 flex items-center gap-3 text-left min-w-0"
              >
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(a.updated_at).toLocaleDateString()}
                    </span>
                    {a.summary && (
                      <span className="text-[10px] text-muted-foreground truncate">{a.summary}</span>
                    )}
                  </div>
                  {(a.tags ?? []).length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(a.tags as string[]).map((t) => (
                        <span key={t} className="intel-tag intel-tag-muted">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  );
}
