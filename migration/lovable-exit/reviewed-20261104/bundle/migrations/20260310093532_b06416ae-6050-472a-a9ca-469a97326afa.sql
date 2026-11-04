
-- Courses
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  difficulty text NOT NULL DEFAULT 'beginner',
  tags text[] DEFAULT '{}',
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed can read published courses" ON public.courses FOR SELECT TO authenticated USING (published = true OR auth.uid() = author_id);
CREATE POLICY "Authors can insert courses" ON public.courses FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Authors can update courses" ON public.courses FOR UPDATE TO authenticated USING (auth.uid() = author_id);
CREATE POLICY "Authors can delete courses" ON public.courses FOR DELETE TO authenticated USING (auth.uid() = author_id);
CREATE TRIGGER trg_courses_updated BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Modules (sections within a course)
CREATE TABLE public.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read modules of visible courses" ON public.modules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.courses WHERE courses.id = modules.course_id AND (courses.published = true OR courses.author_id = auth.uid())));
CREATE POLICY "Authors can manage modules" ON public.modules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.courses WHERE courses.id = modules.course_id AND courses.author_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.courses WHERE courses.id = modules.course_id AND courses.author_id = auth.uid()));

-- Lessons
CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read lessons of visible courses" ON public.lessons FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.modules m JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id AND (c.published = true OR c.author_id = auth.uid())
  ));
CREATE POLICY "Authors can manage lessons" ON public.lessons FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.modules m JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id AND c.author_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.modules m JOIN public.courses c ON c.id = m.course_id
    WHERE m.id = lessons.module_id AND c.author_id = auth.uid()
  ));

-- Progress (enrollment + lesson completion)
CREATE TABLE public.progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id, lesson_id)
);
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own progress" ON public.progress FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
