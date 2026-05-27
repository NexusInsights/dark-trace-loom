import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { GlassPanel } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { UpgradePrompt } from "@/components/tools/UpgradePrompt";
import {
  Store, Search, Download, Star, CheckCircle, Clock, Plus, Filter,
  Users, Shield, MapPin, Link, Phone, Car, Mail, Wifi, Wrench, Package,
} from "lucide-react";
import type { SubscriptionPlan } from "@/hooks/useSubscription";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Users, Shield, MapPin, Link, Phone, Car, Mail, Wifi, Wrench, Package, Store,
};

const PLAN_ORDER: SubscriptionPlan[] = ["free", "professional", "team", "enterprise"];

const PRICING_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  free: { label: "Free", variant: "secondary" },
  subscription: { label: "Subscription", variant: "default" },
  per_use: { label: "Pay per Use", variant: "outline" },
};

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  professional: "Professional",
  team: "Team",
  enterprise: "Enterprise",
};

interface MarketplaceTool {
  id: string;
  tool_name: string;
  slug: string;
  developer_name: string;
  description: string | null;
  long_description: string | null;
  category: string;
  pricing_model: string;
  min_plan: string;
  icon_name: string | null;
  version: string;
  downloads: number;
  rating: number | null;
  status: string;
  tags: string[] | null;
  created_at: string;
}

export default function MarketplacePage() {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedTool, setSelectedTool] = useState<MarketplaceTool | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ["marketplace-tools"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tool_marketplace")
        .select("*")
        .order("downloads", { ascending: false });
      if (error) throw error;
      return data as unknown as MarketplaceTool[];
    },
  });

  const { data: installed = [] } = useQuery({
    queryKey: ["installed-tools"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_installed_tools")
        .select("tool_id, enabled");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const installMutation = useMutation({
    mutationFn: async (toolId: string) => {
      const { error } = await supabase
        .from("user_installed_tools")
        .insert({ user_id: user!.id, tool_id: toolId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installed-tools"] });
      toast({ title: "Tool installed", description: "The tool has been added to your suite." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const uninstallMutation = useMutation({
    mutationFn: async (toolId: string) => {
      const { error } = await supabase
        .from("user_installed_tools")
        .delete()
        .eq("user_id", user!.id)
        .eq("tool_id", toolId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installed-tools"] });
      toast({ title: "Tool removed" });
    },
  });

  const installedIds = new Set(installed.map((i) => i.tool_id));
  const categories = Array.from(new Set(tools.map((t) => t.category)));

  const filtered = tools.filter((t) => {
    const matchesSearch = !search || t.tool_name.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase()) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = categoryFilter === "all" || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const canUseTool = (minPlan: string) => {
    const userIdx = PLAN_ORDER.indexOf(plan);
    const reqIdx = PLAN_ORDER.indexOf(minPlan as SubscriptionPlan);
    return reqIdx >= 0 && userIdx >= reqIdx;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <span className="intel-tag intel-tag-purple mb-3 inline-block">MARKETPLACE</span>
          <h1 className="text-2xl font-display font-bold tracking-tight">Tool Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discover, install, and publish OSINT tools
          </p>
        </div>
        <PublishToolDialog open={publishOpen} onOpenChange={setPublishOpen} userId={user?.id} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tools, tags, categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="font-mono text-xs">
          {filtered.length} tools
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Available Tools", value: tools.length, icon: Package },
          { label: "Installed", value: installedIds.size, icon: CheckCircle },
          { label: "Categories", value: categories.length, icon: Filter },
          { label: "Your Plan", value: PLAN_LABELS[plan] || plan, icon: Shield },
        ].map((s) => (
          <GlassPanel key={s.label} className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <s.icon className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] tracking-wider uppercase">{s.label}</span>
            </div>
            <span className="text-lg font-display font-bold">{s.value}</span>
          </GlassPanel>
        ))}
      </div>

      {/* Tool Grid */}
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="installed">Installed ({installedIds.size})</TabsTrigger>
          <TabsTrigger value="my-tools">My Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <GlassPanel key={i} className="p-5 animate-pulse h-48"><div /></GlassPanel>
              ))}
            </div>
          ) : (
            <ToolGrid
              tools={filtered}
              installedIds={installedIds}
              plan={plan}
              canUseTool={canUseTool}
              onInstall={(id) => installMutation.mutate(id)}
              onUninstall={(id) => uninstallMutation.mutate(id)}
              onSelect={setSelectedTool}
            />
          )}
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          <ToolGrid
            tools={filtered.filter((t) => installedIds.has(t.id))}
            installedIds={installedIds}
            plan={plan}
            canUseTool={canUseTool}
            onInstall={(id) => installMutation.mutate(id)}
            onUninstall={(id) => uninstallMutation.mutate(id)}
            onSelect={setSelectedTool}
          />
        </TabsContent>

        <TabsContent value="my-tools" className="mt-4">
          <ToolGrid
            tools={tools.filter((t) => t.developer_name === "You" || (user && tools.some(
              (tt) => tt.id === t.id
            )))}
            installedIds={installedIds}
            plan={plan}
            canUseTool={canUseTool}
            onInstall={(id) => installMutation.mutate(id)}
            onUninstall={(id) => uninstallMutation.mutate(id)}
            onSelect={setSelectedTool}
            emptyMessage="You haven't published any tools yet."
          />
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <ToolDetailDialog
        tool={selectedTool}
        onClose={() => setSelectedTool(null)}
        isInstalled={selectedTool ? installedIds.has(selectedTool.id) : false}
        canUse={selectedTool ? canUseTool(selectedTool.min_plan) : false}
        plan={plan}
        onInstall={(id) => installMutation.mutate(id)}
        onUninstall={(id) => uninstallMutation.mutate(id)}
      />
    </div>
  );
}

/* ── Tool Card Grid ── */
function ToolGrid({
  tools, installedIds, plan, canUseTool, onInstall, onUninstall, onSelect, emptyMessage,
}: {
  tools: MarketplaceTool[];
  installedIds: Set<string>;
  plan: SubscriptionPlan;
  canUseTool: (p: string) => boolean;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onSelect: (t: MarketplaceTool) => void;
  emptyMessage?: string;
}) {
  if (!tools.length) {
    return (
      <GlassPanel className="p-8 text-center">
        <Store className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{emptyMessage || "No tools found matching your criteria."}</p>
      </GlassPanel>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tools.map((t) => {
        const IconComp = ICON_MAP[t.icon_name || "Wrench"] || Wrench;
        const isInstalled = installedIds.has(t.id);
        const accessible = canUseTool(t.min_plan);
        const pricing = PRICING_LABELS[t.pricing_model] || PRICING_LABELS.free;

        return (
          <div
            key={t.id}
            className="cursor-pointer"
            onClick={() => onSelect(t)}
          >
            <GlassPanel className="p-4 group hover:glow-blue transition-all duration-300 flex flex-col h-full">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-md bg-primary/10 text-primary">
                  <IconComp className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-sm font-semibold truncate">{t.tool_name}</h3>
                    {isInstalled && <CheckCircle className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground">{t.developer_name} · v{t.version}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mb-3 line-clamp-2 flex-1">{t.description}</p>

              <div className="flex items-center gap-2 flex-wrap mb-3">
                <Badge variant={pricing.variant} className="text-[10px]">{pricing.label}</Badge>
                <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                {t.min_plan !== "free" && (
                  <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                    {PLAN_LABELS[t.min_plan]}+
                  </Badge>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" /> {t.downloads.toLocaleString()}
                  </span>
                  {t.rating && (
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3 fill-current text-primary" /> {Number(t.rating).toFixed(1)}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={isInstalled ? "outline" : accessible ? "default" : "secondary"}
                  className="h-7 text-[11px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!accessible) return;
                    isInstalled ? onUninstall(t.id) : onInstall(t.id);
                  }}
                  disabled={!accessible && !isInstalled}
                >
                  {isInstalled ? "Remove" : accessible ? "Install" : `Requires ${PLAN_LABELS[t.min_plan]}`}
                </Button>
              </div>
            </GlassPanel>
          </div>
        );
      })}
    </div>
  );
}

/* ── Tool Detail Dialog ── */
function ToolDetailDialog({
  tool, onClose, isInstalled, canUse, plan, onInstall, onUninstall,
}: {
  tool: MarketplaceTool | null;
  onClose: () => void;
  isInstalled: boolean;
  canUse: boolean;
  plan: SubscriptionPlan;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
}) {
  if (!tool) return null;
  const IconComp = ICON_MAP[tool.icon_name || "Wrench"] || Wrench;
  const pricing = PRICING_LABELS[tool.pricing_model] || PRICING_LABELS.free;

  return (
    <Dialog open={!!tool} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <IconComp className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="font-display">{tool.tool_name}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tool.developer_name} · v{tool.version}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <p className="text-sm text-muted-foreground">{tool.long_description || tool.description}</p>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 rounded-md bg-muted/50">
              <Download className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <span className="text-sm font-bold">{tool.downloads.toLocaleString()}</span>
              <p className="text-[10px] text-muted-foreground">Downloads</p>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/50">
              <Star className="h-4 w-4 mx-auto mb-1 fill-current text-primary" />
              <span className="text-sm font-bold">{tool.rating ? Number(tool.rating).toFixed(1) : "N/A"}</span>
              <p className="text-[10px] text-muted-foreground">Rating</p>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/50">
              <Clock className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <span className="text-sm font-bold">{new Date(tool.created_at).toLocaleDateString()}</span>
              <p className="text-[10px] text-muted-foreground">Published</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Badge variant={pricing.variant}>{pricing.label}</Badge>
            <Badge variant="outline">{tool.category}</Badge>
            {tool.min_plan !== "free" && (
              <Badge variant="outline" className="border-primary/30 text-primary">
                Requires {PLAN_LABELS[tool.min_plan]}+
              </Badge>
            )}
          </div>

          {tool.tags && tool.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {tool.tags.map((tag) => (
                <span key={tag} className="intel-tag intel-tag-blue text-[10px]">{tag}</span>
              ))}
            </div>
          )}

          {!canUse && (
            <UpgradePrompt
              reason={`This tool requires the ${PLAN_LABELS[tool.min_plan]} plan`}
              requiredPlan={tool.min_plan as SubscriptionPlan}
            />
          )}

          <Button
            className="w-full"
            variant={isInstalled ? "outline" : "default"}
            disabled={!canUse && !isInstalled}
            onClick={() => isInstalled ? onUninstall(tool.id) : onInstall(tool.id)}
          >
            {isInstalled ? "Remove from Suite" : canUse ? "Install Tool" : `Upgrade to ${PLAN_LABELS[tool.min_plan]}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Publish Tool Dialog ── */
function PublishToolDialog({
  open, onOpenChange, userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    tool_name: "", slug: "", description: "", long_description: "",
    category: "general", pricing_model: "free", min_plan: "free",
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase.from("tool_marketplace").insert({
        ...form,
        slug: form.slug || form.tool_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        developer_id: userId,
        developer_name: "Community Developer",
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace-tools"] });
      onOpenChange(false);
      setForm({ tool_name: "", slug: "", description: "", long_description: "", category: "general", pricing_model: "free", min_plan: "free" });
      toast({ title: "Tool submitted", description: "Your tool has been submitted for review." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus className="h-4 w-4" /> Publish Tool
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Publish a New Tool</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <label className="text-xs font-medium mb-1 block">Tool Name *</label>
            <Input
              placeholder="My OSINT Tool"
              value={form.tool_name}
              onChange={(e) => setForm({ ...form, tool_name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Description *</label>
            <Textarea
              placeholder="Brief description of what the tool does..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Full Description</label>
            <Textarea
              placeholder="Detailed description, capabilities, data sources..."
              value={form.long_description}
              onChange={(e) => setForm({ ...form, long_description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Category</label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Identity", "Reconnaissance", "Analysis", "Financial", "Threat Intel", "Media", "Utility"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Pricing</label>
              <Select value={form.pricing_model} onValueChange={(v) => setForm({ ...form, pricing_model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                  <SelectItem value="per_use">Pay per Use</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Min Plan</label>
              <Select value={form.min_plan} onValueChange={(v) => setForm({ ...form, min_plan: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLAN_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>{PLAN_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full"
            onClick={() => publishMutation.mutate()}
            disabled={!form.tool_name || !form.description || publishMutation.isPending}
          >
            {publishMutation.isPending ? "Submitting..." : "Submit for Review"}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            Tools are reviewed before being published to the marketplace.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
