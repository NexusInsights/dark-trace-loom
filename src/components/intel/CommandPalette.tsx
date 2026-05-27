import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Home, LayoutDashboard, Wrench, Search, GraduationCap, BookOpen, Code2, CreditCard,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

const pages = [
  { name: "Home", path: "/", icon: Home },
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Tool Suite", path: "/tools", icon: Wrench },
  { name: "Investigations", path: "/investigations", icon: Search },
  { name: "Training", path: "/training", icon: GraduationCap },
  { name: "Knowledge Base", path: "/knowledge", icon: BookOpen },
  { name: "API Reference", path: "/api", icon: Code2 },
  { name: "Pricing", path: "/pricing", icon: CreditCard },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const goTo = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, tools, investigations..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {pages.map((p) => (
            <CommandItem key={p.path} onSelect={() => goTo(p.path)}>
              <p.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {p.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
