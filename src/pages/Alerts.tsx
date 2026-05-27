import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditLog } from "@/hooks/useAuditLog";
import { GlassPanel } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  Bell, BellRing, Plus, Trash2, Globe, User, Database,
  Shield, Eye, Clock, CheckCircle, AlertTriangle, AlertCircle, Info,
} from "lucide-react";

const ALERT_TYPES = [
  { value: "domain_registration", label: "Domain Registration", icon: Globe, description: "Monitor for new domain registrations related to a subject" },
  { value: "username_appearance", label: "Username Appearance", icon: User, description: "Detect new username matches across platforms" },
  { value: "data_change", label: "Data Changes", icon: Database, description: "Track changes to case artifacts and events" },
  { value: "breach_detection", label: "Breach Detection", icon: Shield, description: "Monitor for subject data in breach databases" },
  { value: "mention_monitoring", label: "Mention Monitoring", icon: Eye, description: "Track new entity mentions and references" },
];

const FREQUENCIES = [
  { value: "realtime", label: "Real-time (5 min)" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const SEVERITY_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; tag: string }> = {
  info: { icon: Info, tag: "intel-tag-blue" },
  warning: { icon: AlertTriangle, tag: "intel-tag-amber" },
  critical: { icon: AlertCircle, tag: "intel-tag-red" },
};

interface Alert {
  id: string;
  user_id: string;
  subject_id: string | null;
  alert_type: string;
  frequency: string;
  enabled: boolean;
  last_triggered: string | null;
  last_checked: string | null;
  created_at: string;
  subjects?: { name: string; type: string; case_id: string } | null;
}

interface Notification {
  id: string;
  alert_id: string;
  title: string;
  message: string | null;
  severity: string;
  read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function AlertsPage() {
  const { user } = useAuth();
  const { log: auditLog } = useAuditLog();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*, subjects(name, type, case_id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Alert[];
    },
    enabled: !!user,
  });

  const { data: notifications = [], isLoading: notifsLoading } = useQuery({
    queryKey: ["alert-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as Notification[];
    },
    enabled: !!user,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("alerts").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast({ title: "Alert deleted" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("alert_notifications")
        .update({ read: true })
        .eq("user_id", user!.id)
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-notifications"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const unreadCount = notifications.filter((n) => !n.read).length;
  const activeAlerts = alerts.filter((a) => a.enabled).length;

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <span className="intel-tag intel-tag-amber mb-3 inline-block">MONITORING</span>
          <h1 className="text-2xl font-display font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Subscribe to monitoring alerts for investigation subjects
          </p>
        </div>
        <CreateAlertDialog open={createOpen} onOpenChange={setCreateOpen} userId={user?.id} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Alerts", value: alerts.length, icon: Bell },
          { label: "Active", value: activeAlerts, icon: BellRing },
          { label: "Unread", value: unreadCount, icon: AlertTriangle },
          { label: "Notifications", value: notifications.length, icon: CheckCircle },
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

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px]">
                {unreadCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Alerts Tab */}
        <TabsContent value="alerts" className="mt-4 space-y-3">
          {alertsLoading ? (
            [1, 2, 3].map((i) => (
              <GlassPanel key={i} className="p-4 animate-pulse h-20"><div /></GlassPanel>
            ))
          ) : alerts.length === 0 ? (
            <GlassPanel className="p-10 text-center">
              <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-display font-semibold mb-2">No Alerts Configured</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create alerts to monitor subjects for changes, new appearances, or data breaches.
              </p>
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Create Alert
              </Button>
            </GlassPanel>
          ) : (
            alerts.map((alert) => {
              const typeConfig = ALERT_TYPES.find((t) => t.value === alert.alert_type);
              const TypeIcon = typeConfig?.icon || Bell;

              return (
                <GlassPanel key={alert.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10 text-primary">
                      <TypeIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold">{typeConfig?.label || alert.alert_type}</h4>
                        <Badge variant="outline" className="text-[10px]">{alert.frequency}</Badge>
                        {alert.subjects && (
                          <span className="text-xs text-muted-foreground">
                            → {alert.subjects.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
                        {alert.last_triggered && (
                          <span>Last triggered: {formatRelative(alert.last_triggered)}</span>
                        )}
                        {alert.last_checked && (
                          <span>Last checked: {formatRelative(alert.last_checked)}</span>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={alert.enabled}
                      onCheckedChange={(enabled) =>
                        toggleMutation.mutate({ id: alert.id, enabled })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteMutation.mutate(alert.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </GlassPanel>
              );
            })
          )}
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="mt-4 space-y-3">
          {unreadCount > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => markAllReadMutation.mutate()}
              >
                Mark all as read
              </Button>
            </div>
          )}

          {notifsLoading ? (
            [1, 2, 3].map((i) => (
              <GlassPanel key={i} className="p-4 animate-pulse h-16"><div /></GlassPanel>
            ))
          ) : notifications.length === 0 ? (
            <GlassPanel className="p-10 text-center">
              <CheckCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No notifications yet. Alerts will appear here when triggered.</p>
            </GlassPanel>
          ) : (
            notifications.map((notif) => {
              const sev = SEVERITY_CONFIG[notif.severity] || SEVERITY_CONFIG.info;
              const SevIcon = sev.icon;

              return (
                <GlassPanel
                  key={notif.id}
                  className={`p-4 transition-opacity ${notif.read ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-md bg-muted mt-0.5">
                      <SevIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`intel-tag ${sev.tag} text-[9px]`}>
                          {notif.severity.toUpperCase()}
                        </span>
                        <h4 className="text-sm font-semibold truncate">{notif.title}</h4>
                      </div>
                      {notif.message && (
                        <p className="text-xs text-muted-foreground">{notif.message}</p>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground mt-1 block">
                        {formatRelative(notif.created_at)}
                      </span>
                    </div>
                    {!notif.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] h-7"
                        onClick={() => markReadMutation.mutate(notif.id)}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </GlassPanel>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Create Alert Dialog ── */
function CreateAlertDialog({
  open, onOpenChange, userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const { log: auditLog } = useAuditLog();
  const [alertType, setAlertType] = useState("data_change");
  const [frequency, setFrequency] = useState("daily");
  const [subjectId, setSubjectId] = useState<string>("");

  // Fetch subjects for selection
  const { data: subjects = [] } = useQuery({
    queryKey: ["all-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name, type, case_id")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase.from("alerts").insert({
        user_id: userId,
        subject_id: subjectId || null,
        alert_type: alertType,
        frequency,
      } as any);
      if (error) throw error;
      await auditLog("tool_execution", "alert", undefined, { alert_type: alertType, frequency });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      onOpenChange(false);
      setAlertType("data_change");
      setFrequency("daily");
      setSubjectId("");
      toast({ title: "Alert created", description: "You'll be notified when conditions are met." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> New Alert
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Create Monitoring Alert</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Alert Type Selection */}
          <div>
            <label className="text-xs font-medium mb-2 block">Alert Type</label>
            <div className="space-y-2">
              {ALERT_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <div
                    key={type.value}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      alertType === type.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30"
                    }`}
                    onClick={() => setAlertType(type.value)}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{type.label}</p>
                        <p className="text-[10px] text-muted-foreground">{type.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium mb-1 block">Subject (optional)</label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a subject to monitor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No specific subject</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Frequency */}
          <div>
            <label className="text-xs font-medium mb-1 block">Check Frequency</label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create Alert"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
