import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassPanel, IntelCard } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  BookOpen, ArrowLeft, CheckCircle, Circle, Loader2,
  Plus, X, Save, ChevronRight, GraduationCap, BarChart3,
} from "lucide-react";

// ─── Types ───
type Course = { id: string; title: string; description: string | null; difficulty: string; tags: string[]; author_id: string; published: boolean; created_at: string };
type Module = { id: string; course_id: string; title: string; sort_order: number };
type Lesson = { id: string; module_id: string; title: string; content: string; sort_order: number };
type Progress = { id: string; user_id: string; course_id: string; lesson_id: string | null; completed: boolean; completed_at: string | null };

const DIFF_TAG: Record<string, string> = {
  beginner: "intel-tag-blue",
  intermediate: "intel-tag-purple",
  advanced: "text-warning border-warning/30 bg-warning/8",
};

// ─── Hooks ───
function useCourses() {
  return useQuery({
    queryKey: ["courses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Course[];
    },
  });
}

function useCourseModules(courseId: string | null) {
  return useQuery({
    queryKey: ["modules", courseId],
    enabled: !!courseId,
    queryFn: async () => {
      const { data, error } = await supabase.from("modules").select("*").eq("course_id", courseId!).order("sort_order");
      if (error) throw error;
      return (data ?? []) as Module[];
    },
  });
}

function useModuleLessons(moduleIds: string[]) {
  return useQuery({
    queryKey: ["lessons", moduleIds],
    enabled: moduleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("lessons").select("*").in("module_id", moduleIds).order("sort_order");
      if (error) throw error;
      return (data ?? []) as Lesson[];
    },
  });
}

function useProgress(courseId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["progress", courseId, user?.id],
    enabled: !!courseId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("progress").select("*").eq("course_id", courseId!).eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as Progress[];
    },
  });
}

// ─── Create Course Form ───
function CreateCourseForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState("beginner");
  const [saving, setSaving] = useState(false);

  const [modules, setModules] = useState<{ title: string; lessons: { title: string; content: string }[] }[]>([
    { title: "Module 1", lessons: [{ title: "Lesson 1", content: "" }] },
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Create course
      const { data: course, error: cErr } = await supabase.from("courses")
        .insert({ title, description, difficulty, author_id: user!.id, published: true })
        .select().single();
      if (cErr) throw cErr;

      // Create modules + lessons
      for (let mi = 0; mi < modules.length; mi++) {
        const mod = modules[mi];
        const { data: dbMod, error: mErr } = await supabase.from("modules")
          .insert({ course_id: course.id, title: mod.title, sort_order: mi })
          .select().single();
        if (mErr) throw mErr;

        for (let li = 0; li < mod.lessons.length; li++) {
          const lesson = mod.lessons[li];
          const { error: lErr } = await supabase.from("lessons")
            .insert({ module_id: dbMod.id, title: lesson.title, content: lesson.content, sort_order: li });
          if (lErr) throw lErr;
        }
      }

      qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Course published");
      onDone();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addModule = () => setModules((m) => [...m, { title: `Module ${m.length + 1}`, lessons: [{ title: "Lesson 1", content: "" }] }]);
  const addLesson = (mi: number) => setModules((m) => m.map((mod, i) => i === mi ? { ...mod, lessons: [...mod.lessons, { title: `Lesson ${mod.lessons.length + 1}`, content: "" }] } : mod));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TITLE</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">DIFFICULTY</label>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
            className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="font-mono text-[10px] tracking-widest text-muted-foreground">DESCRIPTION</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
      </div>

      {/* Modules + Lessons */}
      <div className="space-y-3">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground">CURRICULUM</span>
        {modules.map((mod, mi) => (
          <div key={mi} className="border border-border/50 rounded-lg p-3 space-y-2">
            <input value={mod.title} onChange={(e) => setModules((m) => m.map((mm, i) => i === mi ? { ...mm, title: e.target.value } : mm))}
              className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            {mod.lessons.map((lesson, li) => (
              <div key={li} className="pl-4 space-y-1">
                <input value={lesson.title} onChange={(e) => setModules((m) => m.map((mm, i) => i === mi ? { ...mm, lessons: mm.lessons.map((l, j) => j === li ? { ...l, title: e.target.value } : l) } : mm))}
                  placeholder="Lesson title"
                  className="w-full bg-background border border-border/30 rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                <textarea value={lesson.content} onChange={(e) => setModules((m) => m.map((mm, i) => i === mi ? { ...mm, lessons: mm.lessons.map((l, j) => j === li ? { ...l, content: e.target.value } : l) } : mm))}
                  placeholder="Lesson content (Markdown)..." rows={3}
                  className="w-full bg-background border border-border/30 rounded px-2.5 py-1 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>
            ))}
            <button type="button" onClick={() => addLesson(mi)} className="text-[10px] font-mono text-primary hover:underline pl-4">+ ADD LESSON</button>
          </div>
        ))}
        <button type="button" onClick={addModule} className="text-[10px] font-mono text-primary hover:underline">+ ADD MODULE</button>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="neon" size="sm" className="flex-1" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />}
          PUBLISH COURSE
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>CANCEL</Button>
      </div>
    </form>
  );
}

// ─── Main Page ───
export default function TrainingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<"catalog" | "create" | "course">("catalog");
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);

  const { data: courses = [], isLoading } = useCourses();
  const { data: modules = [] } = useCourseModules(activeCourseId);
  const moduleIds = modules.map((m) => m.id);
  const { data: lessons = [] } = useModuleLessons(moduleIds);
  const { data: progress = [] } = useProgress(activeCourseId);

  const activeCourse = courses.find((c) => c.id === activeCourseId);
  const activeLesson = lessons.find((l) => l.id === activeLessonId);
  const isEnrolled = progress.some((p) => p.lesson_id === null);
  const completedLessonIds = new Set(progress.filter((p) => p.completed && p.lesson_id).map((p) => p.lesson_id));
  const totalLessons = lessons.length;
  const completedCount = completedLessonIds.size;
  const progressPct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  const enroll = useMutation({
    mutationFn: async (courseId: string) => {
      const { error } = await supabase.from("progress").insert({ user_id: user!.id, course_id: courseId, lesson_id: null, completed: false });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["progress"] }); toast.success("Enrolled!"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleLesson = useMutation({
    mutationFn: async ({ courseId, lessonId, completed }: { courseId: string; lessonId: string; completed: boolean }) => {
      if (completed) {
        const { error } = await supabase.from("progress").upsert(
          { user_id: user!.id, course_id: courseId, lesson_id: lessonId, completed: true, completed_at: new Date().toISOString() },
          { onConflict: "user_id,course_id,lesson_id" }
        );
        if (error) throw error;
      } else {
        await supabase.from("progress").delete().eq("user_id", user!.id).eq("course_id", courseId).eq("lesson_id", lessonId);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── COURSE VIEW ───
  if (view === "course" && activeCourse) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden animate-fade-in">
        {/* Sidebar: curriculum */}
        <div className="w-72 shrink-0 border-r border-border bg-card/50 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <button onClick={() => { setView("catalog"); setActiveCourseId(null); setActiveLessonId(null); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
              <ArrowLeft className="h-3 w-3" /> BACK TO CATALOG
            </button>
            <h2 className="font-display text-sm font-bold truncate">{activeCourse.title}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{progressPct}%</span>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {modules.map((mod) => {
              const modLessons = lessons.filter((l) => l.module_id === mod.id);
              const modCompleted = modLessons.filter((l) => completedLessonIds.has(l.id)).length;
              return (
                <div key={mod.id}>
                  <div className="px-4 py-2 bg-secondary/30 border-b border-border/30">
                    <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                      {mod.title} ({modCompleted}/{modLessons.length})
                    </span>
                  </div>
                  {modLessons.map((lesson) => {
                    const done = completedLessonIds.has(lesson.id);
                    const active = activeLessonId === lesson.id;
                    return (
                      <button
                        key={lesson.id}
                        onClick={() => setActiveLessonId(lesson.id)}
                        className={`w-full text-left px-4 py-2.5 border-b border-border/20 flex items-center gap-2.5 text-xs transition-colors ${
                          active ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-secondary/40"
                        }`}
                      >
                        {done ? (
                          <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={`truncate ${done ? "text-muted-foreground" : "text-foreground"}`}>{lesson.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main: lesson content */}
        <div className="flex-1 overflow-auto p-6">
          {!activeLesson ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="font-mono text-sm text-muted-foreground">SELECT A LESSON TO BEGIN</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
              <div className="flex items-start justify-between">
                <div>
                  <span className="intel-tag intel-tag-blue mb-2 inline-block">LESSON</span>
                  <h1 className="text-xl font-display font-bold tracking-tight">{activeLesson.title}</h1>
                </div>
                <Button
                  variant={completedLessonIds.has(activeLesson.id) ? "outline" : "neon"}
                  size="sm"
                  onClick={() => toggleLesson.mutate({
                    courseId: activeCourseId!,
                    lessonId: activeLesson.id,
                    completed: !completedLessonIds.has(activeLesson.id),
                  })}
                  disabled={toggleLesson.isPending}
                >
                  {completedLessonIds.has(activeLesson.id) ? (
                    <><CheckCircle className="h-3.5 w-3.5 mr-1.5" />COMPLETED</>
                  ) : (
                    "MARK COMPLETE"
                  )}
                </Button>
              </div>

              <GlassPanel className="p-6" neonLine="top">
                <div className="prose-intel">
                  <ReactMarkdown>{activeLesson.content}</ReactMarkdown>
                </div>
              </GlassPanel>

              {/* Nav */}
              <div className="flex justify-between">
                {(() => {
                  const idx = lessons.findIndex((l) => l.id === activeLesson.id);
                  return (
                    <>
                      <Button variant="outline" size="sm" disabled={idx <= 0} onClick={() => setActiveLessonId(lessons[idx - 1]?.id ?? null)}>
                        <ArrowLeft className="h-3 w-3 mr-1.5" /> PREVIOUS
                      </Button>
                      <Button variant="outline" size="sm" disabled={idx >= lessons.length - 1} onClick={() => setActiveLessonId(lessons[idx + 1]?.id ?? null)}>
                        NEXT <ChevronRight className="h-3 w-3 ml-1.5" />
                      </Button>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── CREATE VIEW ───
  if (view === "create") {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-fade-in space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setView("catalog")} className="p-1.5 rounded hover:bg-secondary transition-colors">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">CREATE COURSE</span>
        </div>
        <GlassPanel className="p-5" neonLine="top">
          <CreateCourseForm onDone={() => setView("catalog")} />
        </GlassPanel>
      </div>
    );
  }

  // ─── CATALOG VIEW ───
  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <span className="intel-tag intel-tag-blue mb-3 inline-block">TRAINING</span>
          <h1 className="text-2xl font-display font-bold tracking-tight">Training Academy</h1>
          <p className="text-sm text-muted-foreground mt-1">Structured learning paths for intelligence professionals</p>
        </div>
        <Button variant="neon" size="sm" onClick={() => setView("create")}>
          <Plus className="h-3 w-3 mr-2" /> CREATE COURSE
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : courses.length === 0 ? (
        <GlassPanel className="p-12 text-center">
          <GraduationCap className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">NO COURSES AVAILABLE</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Create your first training course</p>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <GlassPanel key={c.id} className="p-5 flex flex-col hover:glow-blue transition-all duration-300 group">
              <GraduationCap className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-display text-sm font-semibold mb-1.5">{c.title}</h3>
              <p className="text-xs text-muted-foreground mb-4 flex-1">{c.description || "No description"}</p>
              <div className="flex items-center gap-2 mb-4">
                <span className={`intel-tag ${DIFF_TAG[c.difficulty] ?? "intel-tag-blue"}`}>{c.difficulty.toUpperCase()}</span>
              </div>
              <Button
                variant="neon"
                size="sm"
                className="w-full"
                onClick={() => {
                  setActiveCourseId(c.id);
                  setView("course");
                  if (!isEnrolled) enroll.mutate(c.id);
                }}
              >
                {c.author_id === user?.id ? "MANAGE" : "START COURSE"} <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  );
}
